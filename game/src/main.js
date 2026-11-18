// Solis Heat — the shell that turns a shelf of systems into one game.
// It owns the renderer, the third-person camera and the fixed-step loop, and
// it wires the city, Val's controller, the vehicle fleet, the pedestrian
// crowd, the arsenal, the SPD wanted system, Dante's story campaign, the
// radar HUD, the save menu and the audio synth together with small callback
// hooks, so no system reaches inside another. ?shot=1..4 stages deterministic
// scenes for the entry screenshots and raises window.__shotReady when the
// staged frame has rendered.
import * as THREE from 'three';
import { ProceduralCityTextures } from './world/ProceduralCityTextures.js';
import { SunsetCoastalCity } from './world/SunsetCoastalCity.js';
import { PlayerCharacterController } from './entities/PlayerCharacterController.js';
import { ParticleSystem, VehiclePhysicsAndTraffic, stepVehiclePhysics } from './vehicles/VehiclePhysicsAndTraffic.js';
import { PedestrianCrowdSystem } from './ai/PedestrianCrowdSystem.js';
import { WeaponsAndProjectiles } from './combat/WeaponsAndProjectiles.js';
import { WantedAndPolicePursuit } from './ai/WantedAndPolicePursuit.js';
import { StoryCampaignManager } from './missions/StoryCampaignManager.js';
import { MinimapRadarAndHUD } from './ui/MinimapRadarAndHUD.js';
import { SaveStateMenu } from './systems/SaveStateMenu.js';
import { WebAudioSynthesizer } from './systems/WebAudioSynthesizer.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25;
const SPAWN = new THREE.Vector3(110, 0, 150);
const REPAINT_COST = 150;

export class SolisHeatGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2b1638);
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3200);
    this.cameraYaw = -Math.PI / 2;
    this.cameraPitch = 0.32;
    this.cameraDistance = 6;

    this.textures = new ProceduralCityTextures();
    this.city = new SunsetCoastalCity(this.scene, this.textures);
    this.effects = {
      smoke: new ParticleSystem(this.scene, this.textures.smokeSprite, { size: 2.6, opacity: 0.34, color: 0xd8d4e0 }),
      sparks: new ParticleSystem(this.scene, this.textures.glowSprite, { size: 0.55, opacity: 0.9, color: 0xffc46b, blending: THREE.AdditiveBlending }),
    };
    this.effects.sparks.gravity = -6;
    this.effects.sparks.drag = 2.4;

    this.audio = new WebAudioSynthesizer();
    this.player = new PlayerCharacterController(this.scene, this.city);
    this.fleet = new VehiclePhysicsAndTraffic(this.scene, this.city, this.effects, this.textures);
    this.crowd = new PedestrianCrowdSystem(this.scene, this.city);
    this.weapons = new WeaponsAndProjectiles(this.scene, this.city, this.effects, this.audio, this.textures);
    this.wanted = new WantedAndPolicePursuit(this.scene, this.city, this.effects, this.weapons);
    this.missions = new StoryCampaignManager(this.scene, this.city, this.weapons);
    this.hud = new MinimapRadarAndHUD();
    this.saveMenu = new SaveStateMenu(this);

    this.playerVehicle = null;
    this.playing = false;
    this.elapsed = 0;
    this.keys = new Set();
    this.mouseDown = false;
    this.respawnTimer = 0;
    this.respawnKind = null;
    this.ramCrimeTimer = 0;
    this.lastImpact = 0;
    this.stagingDrive = null;
    this.shotMode = new URLSearchParams(window.location.search).get('shot');

    this.wireSystems();
    this.bindInput();
    this.bindMenu();
    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });
    window.__solisHeat = this;
    if (!this.shotMode) this.missions.begin(0);
  }

  /** Every cross-system conversation happens here, in one place. */
  wireSystems() {
    // Citizens and traffic cars can be shot; hull damage is tracked per car.
    for (const citizen of this.crowd.citizens) {
      this.weapons.registerHittable({
        getPosition: () => citizen.group.position,
        radius: 0.55,
        centreHeight: 1.05,
        kind: 'citizen',
        get dead() { return citizen.dead; },
        onHit: (damage) => this.crowd.damageCitizen(citizen, damage, 'gunshot'),
      });
    }
    for (const vehicle of this.fleet.vehicles) {
      if (vehicle.kind === 'boat') continue;
      vehicle.hullHealth = 220;
      this.weapons.registerHittable({
        getPosition: () => vehicle.position,
        radius: 1.95,
        centreHeight: 0.8,
        kind: 'vehicle',
        get dead() { return vehicle.hullHealth <= 0; },
        onHit: (damage) => this.damageVehicle(vehicle, damage),
      });
    }

    this.weapons.onCrime = (kind, position) => {
      if (kind === 'gunfire' || kind === 'gunfireHit') {
        this.crowd.notifyGunshot(position);
        this.wanted.reportCrime(kind, position);
      } else if (kind === 'assault') {
        this.wanted.reportCrime('assault', position);
      }
    };
    this.weapons.onPickup = (kind, amount) => {
      if (kind === 'cash') this.player.addCash(amount);
    };
    this.crowd.onCitizenDown = (citizen, cause) => {
      if (cause === 'vehicle') this.wanted.reportCrime('citizenDown', citizen.group.position);
      if (Math.random() < 0.35) this.weapons.spawnCashPickup(citizen.group.position, 10 + Math.floor(Math.random() * 25));
    };
    this.wanted.onPlayerDamage = (amount) => {
      if (!this.player.alive || (!this.playing && !this.shotMode)) return;
      const scaled = this.playerVehicle ? amount * 0.45 : amount;
      this.hud.flashDamage();
      if (this.player.damage(scaled)) this.beginRespawn('wasted');
    };
    this.wanted.onBusted = () => this.beginRespawn('busted');
    this.missions.onDialogue = (speaker, text) => this.hud.showDialogue(speaker, text);
    this.missions.onToast = (text) => this.hud.toast(text);
    this.missions.onObjective = (title, objective) => this.hud.setMission(title, objective);
    this.missions.onGuardDown = (guard) => this.wanted.reportCrime('guardDown', guard.group.position);
    this.missions.onEscapeStage = () => this.wanted.setStars(3);
    this.missions.onReward = () => this.audio.blip('cash');
    this.missions.onCampaignComplete = () => this.hud.toast('Story complete — Puerto Solis is yours. Free roam!');
  }

  damageVehicle(vehicle, damage) {
    vehicle.hullHealth -= damage;
    if (vehicle.hullHealth <= 0 && !vehicle.hullWrecked) {
      vehicle.hullWrecked = true;
      this.effects.smoke.burst(vehicle.position, 18, { speed: 2.2, life: 1.2 });
      if (vehicle.driver === 'traffic') {
        this.fleet.removeFromTraffic(vehicle);
        vehicle.driver = 'parked';
        vehicle.parked = true;
        vehicle.velocity.set(0, 0, 0);
      }
    }
  }

  bindInput() {
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      this.keys.add(event.code);
      if (event.code === 'KeyF') this.toggleVehicle();
      if (event.code === 'KeyE') this.tryRepaint();
      if (event.code === 'KeyR') {
        const on = this.audio.toggleRadio();
        this.hud.toast(on ? 'Radio on — Costa FM synthwave' : 'Radio off');
      }
      if (event.code.startsWith('Digit')) {
        const n = Number(event.code.slice(5));
        if (n >= 1 && n <= 4) {
          this.weapons.select(n - 1);
          this.player.setWeaponProp(this.weapons.weapon.id);
        }
      }
      if ((event.code === 'Escape' || event.code === 'KeyP') && !this.shotMode) this.toggleMenu();
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('wheel', (event) => {
      if (!this.playing) return;
      this.weapons.cycle(event.deltaY > 0 ? 1 : -1);
      this.player.setWeaponProp(this.weapons.weapon.id);
    }, { passive: true });
    this.canvas.addEventListener('mousedown', (event) => {
      this.mouseDown = true;
      this.audio.ensure();
      if (this.playing && event.button === 0 && document.pointerLockElement !== this.canvas) {
        this.canvas.requestPointerLock();
      }
    });
    window.addEventListener('mouseup', () => { this.mouseDown = false; });
    window.addEventListener('mousemove', (event) => {
      if (document.pointerLockElement === this.canvas) {
        this.cameraYaw -= event.movementX * 0.0026;
        this.cameraPitch = Math.max(0.04, Math.min(1.05, this.cameraPitch + event.movementY * 0.0022));
      }
    });
  }

  bindMenu() {
    this.modal = document.getElementById('start-and-save-modal');
    document.getElementById('menu-btn-play').addEventListener('click', () => {
      this.audio.ensure();
      this.startPlay();
    });
  }

  toggleMenu() {
    if (this.playing) {
      this.playing = false;
      this.modal.classList.remove('hidden');
      this.saveMenu.refreshStatus();
      document.exitPointerLock?.();
    } else {
      this.startPlay();
    }
  }

  startPlay() {
    this.playing = true;
    this.modal.classList.add('hidden');
  }

  /** The vehicle Val can reach: cars up close, the boat from the pier edge. */
  nearestEnterable() {
    const near = this.fleet.nearestVehicle(this.player.position, 4.6);
    if (!near) return null;
    if (near.kind !== 'boat' && near.position.distanceTo(this.player.position) > 3.8) return null;
    return near;
  }

  toggleVehicle() {
    if (!this.playing && !this.shotMode) return;
    if (this.playerVehicle) {
      this.exitVehicle();
      return;
    }
    const vehicle = this.nearestEnterable();
    if (!vehicle) return;
    const wasTraffic = vehicle.driver === 'traffic';
    if (wasTraffic) {
      this.fleet.removeFromTraffic(vehicle);
      this.crowd.ejectDriverAt(vehicle.position, vehicle.heading);
      this.wanted.reportCrime('hijack', vehicle.position);
      this.audio.blip('alarm');
    }
    vehicle.driver = 'player';
    vehicle.parked = false;
    this.playerVehicle = vehicle;
    this.player.group.visible = false;
    this.cameraYaw = vehicle.heading + Math.PI;
    this.hud.setPrompt(null);
  }

  exitVehicle(instant = false) {
    const vehicle = this.playerVehicle;
    if (!vehicle) return;
    const side = new THREE.Vector3(Math.cos(vehicle.heading), 0, -Math.sin(vehicle.heading));
    const spot = vehicle.position.clone().addScaledVector(side, -2.6);
    if (vehicle.kind === 'boat' || this.city.isWater(spot.x, spot.z)) {
      // Step out onto the pier or the shoreline, never into the sea.
      let x = vehicle.position.x;
      while (x > 60 && this.city.isWater(x, spot.z)) x -= 2;
      spot.set(x, 0, spot.z);
      if (this.city.isWater(spot.x, spot.z)) spot.set(180, 0, 23);
    }
    spot.y = this.city.groundHeightAt(spot.x, spot.z);
    this.player.position.copy(spot);
    this.player.group.visible = true;
    vehicle.driver = 'parked';
    vehicle.parked = true;
    vehicle.velocity.multiplyScalar(instant ? 0 : 0.4);
    this.playerVehicle = null;
  }

  /** Solis Customs: stand in the glowing bay, press E, leave clean. */
  tryRepaint() {
    if (!this.playerVehicle || this.playerVehicle.kind === 'boat') return;
    const pad = this.city.customsPad;
    const p = this.playerVehicle.position;
    if (p.x < pad.minX || p.x > pad.maxX || p.z < pad.minZ || p.z > pad.maxZ) return;
    if (this.player.cash < REPAINT_COST) {
      this.hud.toast(`Repaint costs $${REPAINT_COST}`);
      return;
    }
    this.player.addCash(-REPAINT_COST);
    const paintChoices = [0xff4b33, 0x2bb3ff, 0x27c46b, 0xffd166, 0xb04fd8, 0xf2f2f2];
    const next = paintChoices[Math.floor(Math.random() * paintChoices.length)];
    this.playerVehicle.group.traverse((node) => {
      if (node.isMesh && node.material && node.material.isMeshPhongMaterial && node.material.shininess === 90) {
        node.material = node.material.clone();
        node.material.color.setHex(next);
      }
    });
    const hadStars = this.wanted.stars > 0;
    this.wanted.clearWanted();
    this.audio.blip('repaint');
    this.hud.toast(hadStars ? 'Fresh paint — the SPD lost you' : 'Fresh paint — looking sharp');
  }

  beginRespawn(kind) {
    if (this.respawnTimer > 0) return;
    this.respawnKind = kind;
    this.respawnTimer = 2.4;
    if (kind === 'busted') {
      this.hud.toast('APPREHENDED — the SPD impound your evening');
    } else {
      this.hud.toast('NEUTRALIZED');
    }
    this.audio.blip('alarm');
  }

  finishRespawn() {
    const kind = this.respawnKind;
    this.respawnKind = null;
    if (this.playerVehicle) this.exitVehicle(true);
    const fine = Math.floor(this.player.cash * (kind === 'busted' ? 0.12 : 0.1));
    this.player.addCash(-fine);
    this.wanted.clearWanted();
    // Busted wakes up outside the SPD lockup in Corona Plaza; wasted wakes
    // up at the Costa Oeste clinic. Either way the night goes on.
    const spot = kind === 'busted' ? new THREE.Vector3(14, 0, 16) : new THREE.Vector3(-140, 0, -14);
    this.player.respawn(spot);
    this.cameraYaw = Math.PI * 0.75;
    if (fine > 0) this.hud.toast(`Released — $${fine.toLocaleString()} in fines and fees`);
  }

  resetCampaign() {
    if (this.playerVehicle) this.exitVehicle(true);
    this.player.respawn(SPAWN.clone());
    this.player.cash = 250;
    this.player.armor = 0;
    this.weapons.ammo = { smg: 320, shotgun: 48 };
    this.weapons.select(0);
    this.player.setWeaponProp('unarmed');
    this.wanted.clearWanted();
    this.missions.begin(0);
    this.hud.toast('New campaign — good luck out there, Val');
  }

  readDriveInput() {
    if (this.stagingDrive) return this.stagingDrive;
    const k = this.keys;
    return {
      throttle: (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) + (k.has('KeyS') || k.has('ArrowDown') ? -1 : 0),
      steer: (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) + (k.has('KeyA') || k.has('ArrowLeft') ? -1 : 0),
      handbrake: k.has('Space'),
    };
  }

  readWalkInput() {
    const k = this.keys;
    let forward = 0;
    let strafe = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) forward += 1;
    if (k.has('KeyS') || k.has('ArrowDown')) forward -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) strafe += 1;
    if (k.has('KeyA') || k.has('ArrowLeft')) strafe -= 1;
    if (k.has('KeyQ')) this.cameraYaw += 0.03;
    if (k.has('KeyE')) this.cameraYaw -= 0.03;
    return { forward, strafe, sprint: k.has('ShiftLeft') || k.has('ShiftRight') };
  }

  update(dt) {
    this.elapsed += dt;
    this.city.update(dt, this.elapsed);
    const anchor = this.playerVehicle ? this.playerVehicle.position : this.player.position;

    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.finishRespawn();
    }

    if (this.playing) {
      if (this.playerVehicle) {
        const impact = stepVehiclePhysics(this.playerVehicle, dt, this.readDriveInput(), this.city, this.effects);
        const ratio = Math.abs(this.playerVehicle.forwardSpeed()) / this.playerVehicle.spec.maxSpeed;
        this.audio.setEngine(true, ratio, this.playerVehicle.drifting);
        if (impact > 3.2 && impact - this.lastImpact > 1.2) this.audio.thud(Math.min(1.4, impact / 6));
        if (impact > 7) {
          this.ramCrimeTimer -= dt;
          if (this.ramCrimeTimer <= 0) {
            this.wanted.reportCrime('ramming', this.playerVehicle.position);
            this.ramCrimeTimer = 1.6;
          }
        }
        this.lastImpact = impact;
      } else {
        this.player.aiming = this.weapons.index > 0 && this.player.alive;
        this.player.update(dt, this.readWalkInput(), this.cameraYaw);
        this.audio.setEngine(false);
        this.updateCombat(dt);
      }
      this.fleet.update(dt, anchor, this.playerVehicle);
      this.crowd.update(dt, this.fleet.vehicles, this.playerVehicle);
    }

    this.weapons.update(dt, anchor);
    this.wanted.update(dt, {
      playerPos: anchor,
      playerVehicle: this.playerVehicle,
      playerSpeed: this.playerVehicle ? Math.abs(this.playerVehicle.forwardSpeed()) : this.player.speedNow,
      playerAlive: this.player.alive,
      active: this.playing,
    });
    if (this.playing) {
      this.missions.update(dt, {
        playerPos: anchor,
        playerVehicle: this.playerVehicle,
        player: this.player,
        wanted: this.wanted,
        customsPad: this.city.customsPad,
      });
    }

    // Siren loudness follows the nearest live unit.
    if (this.wanted.stars > 0) {
      const nearest = this.wanted.nearestPoliceDistance(anchor);
      this.audio.setSiren(Math.max(0, Math.min(1, 1 - nearest / 65)));
    } else {
      this.audio.setSiren(0);
    }

    this.effects.smoke.update(dt);
    this.effects.sparks.update(dt);
    this.updateCamera(dt);
    this.updateSpeedometer();
    this.updatePrompt();
    this.hud.update(dt, {
      player: this.player,
      playerPos: anchor,
      playerVehicle: this.playerVehicle,
      playerHeading: this.playerVehicle ? this.playerVehicle.heading : this.player.heading,
      weapons: this.weapons,
      wanted: this.wanted,
      fleet: this.fleet,
      police: this.wanted,
      guards: this.missions.guards,
      missionTarget: this.missions.targetPoint(),
      city: this.city,
      aiming: !this.playerVehicle && this.player.aiming && this.playing,
    });
  }

  updateCombat(dt) {
    if (!this.player.alive) return;
    const origin = this.camera.position.clone();
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const muzzle = this.player.position.clone();
    muzzle.y += 1.45;
    const forward = new THREE.Vector3(Math.sin(this.player.heading), 0, Math.cos(this.player.heading));
    muzzle.addScaledVector(forward, 0.5);
    this.weapons.tryFire(dt, this.mouseDown && this.playing, origin, dir, muzzle);
  }

  updatePrompt() {
    if (!this.playing) { this.hud.setPrompt(null); return; }
    if (this.playerVehicle) {
      const pad = this.city.customsPad;
      const p = this.playerVehicle.position;
      if (p.x >= pad.minX && p.x <= pad.maxX && p.z >= pad.minZ && p.z <= pad.maxZ) {
        this.hud.setPrompt(`[E] Repaint & clear heat — $${REPAINT_COST}`);
      } else {
        this.hud.setPrompt(null);
      }
      return;
    }
    const vehicle = this.nearestEnterable();
    if (!vehicle) { this.hud.setPrompt(null); return; }
    if (vehicle.kind === 'boat') this.hud.setPrompt('[F] Board Marina Speedboat');
    else if (vehicle.driver === 'traffic') this.hud.setPrompt(`[F] Hijack ${vehicle.label}`);
    else this.hud.setPrompt(`[F] Enter ${vehicle.label}`);
  }

  updateCamera(dt) {
    const driving = !!this.playerVehicle;
    const target = driving ? this.playerVehicle.position : this.player.position;
    if (driving) {
      const behind = this.playerVehicle.heading + Math.PI;
      let diff = behind - this.cameraYaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const speed = Math.abs(this.playerVehicle.forwardSpeed());
      this.cameraYaw += diff * Math.min(1, dt * (0.7 + speed * 0.03));
    }
    const wantedDistance = driving ? 10.5 + Math.abs(this.playerVehicle.forwardSpeed()) * 0.12 : 6;
    this.cameraDistance += (wantedDistance - this.cameraDistance) * Math.min(1, dt * 3);
    const pitch = driving ? Math.max(0.14, this.cameraPitch * 0.6) : this.cameraPitch;
    const offset = new THREE.Vector3(
      Math.sin(this.cameraYaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(this.cameraYaw) * Math.cos(pitch),
    ).multiplyScalar(this.cameraDistance);
    const position = target.clone().add(offset);
    position.y += driving ? 1.6 : 1.7;
    position.y = Math.max(position.y, this.city.groundHeightAt(position.x, position.z) + 0.6);
    this.camera.position.copy(position);
    this.camera.lookAt(target.x, target.y + (driving ? 1.5 : 1.75), target.z);
  }

  updateSpeedometer() {
    const value = document.getElementById('hud-speed-value');
    const name = document.getElementById('hud-vehicle-name');
    if (this.playerVehicle) {
      value.textContent = String(Math.round(this.playerVehicle.speedKmh()));
      name.textContent = this.playerVehicle.label.toUpperCase();
    } else {
      value.textContent = '0';
      name.textContent = 'ON FOOT';
    }
  }

  /**
   * Deterministic staging for the entry screenshots. Each scene poses the
   * real systems (never a mock-up): the chase is driven by the pursuit AI,
   * the combat shot fires a live SMG burst, the menu shot saves a real game.
   */
  stageShot(name) {
    this.missions.begin(0);
    if (name !== '4') this.modal.classList.add('hidden');
    if (name === '1') this.stageChase();
    else if (name === '2') this.stageOnFootCombat();
    else if (name === '3') this.stageHarborMission();
    else if (name === '4') this.stageMenuScene();
  }

  runStagedSteps(steps) {
    for (let i = 0; i < steps; i += 1) this.update(STEP);
  }

  stageChase() {
    // The cover: Val in the coral coupe at speed on the coast road, three
    // stars up, two Interceptors on her tail, the pier beacon dead ahead and
    // the sunset over the water beyond it. The first staged step completes
    // mission 1's "enter the coupe" stage, so the panel shows the drive-to
    // objective and the beacon stands at the pier.
    const coupe = this.fleet.vehicles.find((v) => v.kind === 'coupe' && v.driver === 'parked');
    coupe.position.set(28, 0, 36.6);
    coupe.heading = Math.PI / 2;
    coupe.velocity.set(38, 0, 0);
    this.player.group.visible = false;
    this.playerVehicle = coupe;
    coupe.driver = 'player';
    coupe.parked = false;
    this.cameraYaw = -Math.PI / 2;
    this.cameraPitch = 0.3;
    this.playing = true;
    this.wanted.setStars(3);
    this.wanted.spawnUnit(coupe.position);
    this.wanted.spawnUnit(coupe.position);
    this.stagingDrive = { throttle: 0.55, steer: 0, handbrake: false };
    this.runStagedSteps(105);
    // Pose the two closest units tight behind her for the cover frame.
    const units = this.wanted.units
      .filter((u) => !u.wrecked)
      .sort((a, b) => a.vehicle.position.distanceTo(coupe.position) - b.vehicle.position.distanceTo(coupe.position));
    if (units[0]) {
      units[0].vehicle.position.set(coupe.position.x - 7.5, 0, coupe.position.z + 3.4);
      units[0].vehicle.heading = Math.PI / 2;
      units[0].vehicle.velocity.set(37, 0, 0);
    }
    if (units[1]) {
      units[1].vehicle.position.set(coupe.position.x - 9.5, 0, coupe.position.z - 3.6);
      units[1].vehicle.heading = Math.PI / 2;
      units[1].vehicle.velocity.set(36, 0, 0);
    }
    // The cover car reads bright coral with lit tails (the same paint
    // materials the customs repaint recolours), and two traffic cars ahead
    // give the chase depth.
    coupe.group.traverse((node) => {
      if (node.isMesh && node.material && node.material.isMeshPhongMaterial && node.material.shininess === 90) {
        node.material.color.setHex(0xff4b33);
      }
    });
    if (coupe.group.userData.tailMaterial) coupe.group.userData.tailMaterial.color.setHex(0xff2a33);
    const trafficAhead = this.fleet.traffic[0];
    if (trafficAhead) {
      trafficAhead.position.set(coupe.position.x + 34, 0, 36.6);
      trafficAhead.heading = Math.PI / 2;
      trafficAhead.velocity.set(24, 0, 0);
    }
    const trafficOncoming = this.fleet.traffic[1];
    if (trafficOncoming) {
      trafficOncoming.position.set(coupe.position.x + 55, 0, 43.4);
      trafficOncoming.heading = -Math.PI / 2;
      trafficOncoming.velocity.set(-24, 0, 0);
    }
    this.hud.showDialogue('DANTE', 'They are right on us, Val — do not stop for anything!', 30);
    this.update(STEP); // one live step so the HUD paints the posed state
    // Pull the cover camera back by hand (the menu scene does the same) so
    // the coupe and both Interceptors compose in one frame.
    this.camera.position.set(coupe.position.x - 21, 5.4, coupe.position.z - 1.5);
    this.camera.lookAt(coupe.position.x + 8, 1.0, coupe.position.z + 0.5);
  }

  stageOnFootCombat() {
    // Val on the neon boulevard, SMG up, facing the hotel row: a traffic
    // coupe idles at the kerb beside her, bystanders scatter the pavement, an
    // Interceptor rolls in down the street, and her burst freezes mid-flight.
    this.playing = true;
    this.player.position.set(106, 0, 40.5);
    this.player.heading = -1.45;
    this.cameraYaw = Math.PI / 2 + 0.12;
    this.cameraPitch = 0.3;
    this.weapons.select(2);
    this.player.setWeaponProp('smg');
    this.player.aiming = true;
    const traffic = this.fleet.traffic.find((v) => v.kind === 'coupe') || this.fleet.traffic[0];
    if (traffic) {
      this.fleet.removeFromTraffic(traffic);
      traffic.position.set(98.5, 0, 45);
      traffic.heading = -0.5;
      traffic.velocity.set(0, 0, 0);
      traffic.driver = 'traffic';
      this.fleet.traffic.push(traffic);
    }
    const bystanders = [[100, 36.5, 2.4], [96, 43.5, -0.8], [102, 34, 1.1]];
    bystanders.forEach(([x, z, rot], i) => {
      const citizen = this.crowd.citizens[i];
      if (!citizen) return;
      citizen.group.position.set(x, 0, z);
      citizen.group.rotation.y = rot;
    });
    this.wanted.setStars(2);
    this.runStagedSteps(24);
    if (traffic) traffic.driver = 'parked';
    // Exactly one Interceptor in frame, headlights on Val, so the wanted
    // stars read gold (chased) instead of cooling blue.
    for (const unit of [...this.wanted.units]) this.wanted.retireUnit(unit);
    const unit = this.wanted.spawnUnit(this.player.position);
    if (unit) {
      unit.vehicle.position.set(84, 0, 36.6);
      unit.vehicle.heading = Math.PI / 2;
      unit.vehicle.velocity.set(0, 0, 0);
    }
    this.wanted.mode = 'chased';
    const origin = this.player.position.clone();
    origin.y += 1.55;
    const dir = new THREE.Vector3(-1, 0.02, -0.05).normalize();
    const muzzle = origin.clone().add(new THREE.Vector3(-0.55, -0.08, 0));
    this.weapons.tryFire(0.016, true, origin, dir, muzzle);
    this.hud.showDialogue('VAL', 'Move, people — this street is mine tonight.', 30);
    this.updateCamera(0.016);
    this.update(STEP); // refresh the HUD (gold stars) on the posed state
    this.hud.setPrompt('[F] Hijack Vulcano Coupe');
  }

  stageHarborMission() {
    // The offshore job: Val at the pier head, the speedboat alongside, two
    // Escorpion guards watching the dock, the yacht beacon burning offshore.
    this.player.cash = 1850;
    this.player.armor = 40;
    this.missions.begin(3);
    this.playing = true;
    this.player.position.set(192, 0.57, 25.5);
    this.player.heading = 1.32;
    this.cameraYaw = -1.82;
    this.cameraPitch = 0.3;
    this.weapons.select(1);
    this.player.setWeaponProp('pistol');
    this.missions.spawnGuards({ kind: 'defeat', count: 2, around: [204, 23], spread: 7 });
    // Clear the pier's strolling citizens out of the frame and moor the
    // speedboat alongside the pier end, on open water, where it reads.
    this.crowd.citizens.forEach((citizen, i) => {
      if (citizen.group.position.x > 150) citizen.group.position.set(115.5, 0, 60 + i * 8);
    });
    const boat = this.fleet.vehicles.find((v) => v.kind === 'boat');
    if (boat) {
      boat.position.set(210, 0, 33.5);
      boat.heading = -0.9;
    }
    this.runStagedSteps(40);
    this.hud.showDialogue('DANTE', 'The yacht is waiting offshore, Val. Take the speedboat.', 30);
    this.updateCamera(0.016);
    this.update(STEP);
  }

  stageMenuScene() {
    // The start & save panel over the living city at sunset. Saving here is
    // real: the slot line in the panel shows the state this scene stored.
    this.playing = false;
    this.player.position.set(110, 0, 96);
    this.modal.classList.remove('hidden');
    this.saveMenu.saveGame();
    this.saveMenu.refreshStatus();
    this.camera.position.set(40, 30, -20);
    this.camera.lookAt(190, 2, 110);
  }

  run() {
    if (this.shotMode) {
      this.stageShot(this.shotMode);
      let frames = 0;
      const paint = () => {
        if (this.shotMode === '4') {
          // Keep the menu's backdrop alive: traffic and crowds keep moving.
          this.city.update(0.016, frames * 0.016);
          this.fleet.update(0.016, this.player.position, null);
          this.crowd.update(0.016, this.fleet.vehicles, null);
        } else {
          this.city.update(0.016, frames * 0.016);
        }
        this.renderer.render(this.scene, this.camera);
        frames += 1;
        if (frames < 16) requestAnimationFrame(paint);
        else window.__shotReady = true;
      };
      requestAnimationFrame(paint);
      return;
    }
    let accumulator = 0;
    let last = performance.now();
    const frame = (now) => {
      requestAnimationFrame(frame);
      accumulator += Math.min((now - last) / 1000, MAX_FRAME);
      last = now;
      while (accumulator >= STEP) {
        this.update(STEP);
        accumulator -= STEP;
      }
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(frame);
  }
}

const game = new SolisHeatGame();
game.run();
