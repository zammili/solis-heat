// StoryCampaignManager — Val Mendoza's one long night in Puerto Solis, told in
// five chained jobs for Dante Reyes against the Los Escorpiones port syndicate,
// then an open-ended delivery contract once the story is done. Every mission
// is a small state machine (go somewhere, take a car, clear a guard post,
// outrun the heat, reach the boat) watched over by a 30-metre golden beacon
// you can see from across the map, radio dialogue in the subtitle bar, and a
// cash reward that lands the moment the last stage closes.
import * as THREE from 'three';
import { createHumanoidFigure, animateHumanoid } from '../ai/PedestrianCrowdSystem.js';

const GUARD_SHIRTS = [0x23272e, 0x3a2320, 0x1f3038];
const GUARD_PANTS = 0x191b20;

/** One armed syndicate guard: stands his post, advances, and shoots back. */
class SyndicateGuard {
  constructor(scene, city, weapons, position, health = 100) {
    this.city = city;
    this.weapons = weapons;
    this.figure = createHumanoidFigure({
      shirt: GUARD_SHIRTS[Math.floor(Math.random() * GUARD_SHIRTS.length)],
      pants: GUARD_PANTS, skin: 0xc68863, hair: 0x14100c,
    });
    this.group = this.figure.group;
    this.group.position.copy(position);
    scene.add(this.group);
    // A dark rifle block in the right hand, like Val's own prop.
    const rifle = new THREE.Mesh(
      new THREE.BoxGeometry(0.09, 0.18, 0.95),
      new THREE.MeshLambertMaterial({ color: 0x101014 }),
    );
    rifle.position.set(0, -0.8, 0.3);
    this.figure.armR.add(rifle);
    this.health = health;
    this.dead = false;
    this.phase = Math.random() * 8;
    this.shootTimer = 1.2 + Math.random() * 1.6;
    this.post = position.clone();
    this.onDown = null;
    this.hittable = weapons.registerHittable({
      getPosition: () => this.group.position,
      radius: 0.62,
      centreHeight: 1.05,
      kind: 'guard',
      onHit: (damage) => this.takeHit(damage),
    });
  }

  takeHit(damage) {
    if (this.dead) return;
    this.health -= damage;
    if (this.health <= 0) {
      this.dead = true;
      this.hittable.dead = true;
      this.group.rotation.x = -Math.PI / 2;
      this.group.position.y = this.city.groundHeightAt(this.group.position.x, this.group.position.z) + 0.25;
      if (this.onDown) this.onDown(this);
    }
  }

  update(dt, playerPos) {
    if (this.dead) return;
    const pos = this.group.position;
    const dist = pos.distanceTo(playerPos);
    const toPlayer = Math.atan2(playerPos.x - pos.x, playerPos.z - pos.z);
    this.group.rotation.y = toPlayer;
    if (dist < 46 && dist > 13) {
      // Close the distance, weaving a little so he is not a statue target.
      const weave = Math.sin(this.phase * 2.1) * 0.35;
      const dirX = Math.sin(toPlayer + weave);
      const dirZ = Math.cos(toPlayer + weave);
      pos.x += dirX * 2.1 * dt;
      pos.z += dirZ * 2.1 * dt;
      this.city.resolveCircle(pos, 0.5);
      pos.y = this.city.groundHeightAt(pos.x, pos.z);
      this.phase += dt * 6;
      animateHumanoid(this.figure, this.phase, 0.9);
    } else {
      this.figure.armR.rotation.x = -Math.PI / 2 + 0.1;
      this.figure.armL.rotation.x = -Math.PI / 2 + 0.35;
    }
    if (dist < 44) {
      this.shootTimer -= dt;
      if (this.shootTimer <= 0) {
        this.shootTimer = 1.1 + Math.random() * 1.1;
        this.weapons.enemyFire(pos, playerPos, { damage: 5.5, range: 46, tracerColor: 0xff5c47 });
      }
    }
  }

  dispose(scene, weapons) {
    weapons.unregisterHittable(this.hittable);
    scene.remove(this.group);
  }
}

const MISSION_SCRIPTS = [
  {
    title: 'Sunset Pickup',
    reward: 400,
    intro: [
      ['DANTE', 'Val, the coral coupe by the promenade is fuelled and hot. Take it.'],
      ['VAL', 'And the Escorpiones just let me drive away?'],
      ['DANTE', 'They will wave. Drive to the end of Playa Coral Pier — a buyer waits.'],
    ],
    stages: [
      { kind: 'enterKind', vehicleKind: 'coupe', objective: 'Get into the coral Vulcano Coupe by the promenade.' },
      { kind: 'driveTo', point: [206, 23], radius: 10, objective: 'Drive the coupe to the beacon at the end of Playa Coral Pier.' },
    ],
    outro: [['DANTE', 'Buyer is happy. Four hundred, wired. Do not spend it all on paint.']],
  },
  {
    title: 'Harbor Raid',
    reward: 650,
    intro: [
      ['DANTE', 'Los Escorpiones are loading our cargo at Muelle Norte tonight.'],
      ['VAL', 'You want it back, or you want it loud?'],
      ['DANTE', 'Both. Clear their guards off the container yard.'],
    ],
    stages: [
      { kind: 'reach', point: [-96, -228], radius: 16, objective: 'Head to the Muelle Norte container yard, north of the city.' },
      { kind: 'defeat', count: 4, around: [-110, -240], spread: 26, objective: 'Clear the Escorpion guards guarding the cargo.' },
    ],
    outro: [['DANTE', 'Cargo is ours again. The port is talking about you, Val.']],
  },
  {
    title: 'Boulevard Heat',
    reward: 800,
    intro: [
      ['DANTE', 'That raid tripped every alarm in the port. SPD is rolling — three stars!'],
      ['VAL', 'Then I vanish. Customs repaint or I outrun them.'],
      ['DANTE', 'Lose the heat, any way you can. Do NOT get cornered on foot.'],
    ],
    stages: [
      { kind: 'escape', objective: 'Lose the SPD: break their sight, or repaint at Solis Customs (E).' },
    ],
    outro: [['DANTE', 'Gone like a rumour. The Task Force is furious. Beautiful.']],
  },
  {
    title: 'Offshore Getaway',
    reward: 1000,
    intro: [
      ['DANTE', 'A courier pouch has to reach the yacht anchored off Playa Coral.'],
      ['VAL', 'By boat, at sunset, with the whole port watching.'],
      ['DANTE', 'The speedboat is tied at the pier. Try not to beach it.'],
    ],
    stages: [
      { kind: 'reach', point: [200, 23], radius: 11, objective: 'Go to the end of Playa Coral Pier.' },
      { kind: 'boatTo', point: [330, 46], radius: 17, objective: 'Take the Marina Speedboat out to the yacht off the coast.' },
    ],
    outro: [['DANTE', 'Pouch delivered. The captain sends his regards — and a thousand.']],
  },
  {
    title: 'Corona Finale',
    reward: 2500,
    intro: [
      ['DANTE', 'Last job. The Escorpion lieutenant is showing off in Corona Plaza.'],
      ['VAL', 'In the open? He wants an audience.'],
      ['DANTE', 'Give him one. End this, and Puerto Solis is ours again.'],
    ],
    stages: [
      { kind: 'reach', point: [10, 10], radius: 14, objective: 'Go to Corona Plaza, in the heart of downtown.' },
      { kind: 'defeat', count: 6, around: [10, 10], spread: 20, lieutenant: true, objective: 'Defeat the Escorpion lieutenant and his crew in Corona Plaza.' },
    ],
    outro: [
      ['DANTE', 'It is done. The port, the boulevard, the night — ours.'],
      ['VAL', 'Then I drive for myself now. Keep the radio on, Dante.'],
    ],
  },
];

export class StoryCampaignManager {
  constructor(scene, city, weapons) {
    this.scene = scene;
    this.city = city;
    this.weapons = weapons;
    this.missionIndex = 0;
    this.stageIndex = 0;
    this.guards = [];
    this.guardsLeft = 0;
    this.dialogueQueue = [];
    this.dialogueTimer = 0;
    this.complete = false;
    this.contractStage = 0;
    // Hooks the game shell assigns:
    this.onDialogue = null; // (speaker, text) => void; (null) hides the bar
    this.onToast = null; // (text) => void
    this.onObjective = null; // (title, objective) => void
    this.onGuardDown = null; // (guard) => void

    // The golden mission beacon: two nested additive cylinders, visible for miles.
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0xffc93c, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.beacon = new THREE.Mesh(new THREE.CylinderGeometry(2.3, 2.3, 34, 20, 1, true), beaconMat);
    const innerMat = beaconMat.clone();
    innerMat.opacity = 0.5;
    this.beaconInner = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 34, 12, 1, true), innerMat);
    this.beacon.add(this.beaconInner);
    this.beacon.position.y = 17;
    this.beaconLight = new THREE.PointLight(0xffc93c, 160, 42, 1.6);
    this.scene.add(this.beacon);
    this.scene.add(this.beaconLight);
    this.elapsed = 0;
  }

  get script() {
    return MISSION_SCRIPTS[this.missionIndex] ?? null;
  }

  get stage() {
    return this.script ? this.script.stages[this.stageIndex] : null;
  }

  /** World position the beacon (and the minimap route) should mark, if any. */
  targetPoint() {
    const stage = this.stage;
    if (!stage) {
      if (this.complete) return this.contractTarget();
      return null;
    }
    if (stage.kind === 'enterKind') return null; // the car is two streets away; no beacon
    if (stage.kind === 'escape') return new THREE.Vector3(-171, 0, 58);
    if (stage.point) return new THREE.Vector3(stage.point[0], 0, stage.point[1]);
    if (stage.around) return new THREE.Vector3(stage.around[0], 0, stage.around[1]);
    return null;
  }

  contractTarget() {
    return this.contractStage === 0 ? null : new THREE.Vector3(-171, 0, 58);
  }

  /** Begin (or restart) the mission at `index`, with its radio intro. */
  begin(index) {
    this.clearGuards();
    this.missionIndex = index;
    this.stageIndex = 0;
    this.complete = false;
    const script = this.script;
    if (!script) { this.complete = true; return; }
    this.playDialogue(script.intro);
    this.enterStage();
    if (this.onObjective) this.onObjective(script.title, this.stage.objective);
  }

  /** Restore from a save: jump straight to a mission with no intro chatter. */
  restore(index) {
    this.clearGuards();
    this.missionIndex = Math.max(0, Math.min(MISSION_SCRIPTS.length, index));
    this.stageIndex = 0;
    this.contractStage = 0;
    if (this.missionIndex >= MISSION_SCRIPTS.length) {
      this.complete = true;
      if (this.onObjective) this.onObjective('Free Roam', 'Contract: deliver any car to Solis Customs for $300.');
      return;
    }
    this.complete = false;
    this.enterStage();
    if (this.onObjective) this.onObjective(this.script.title, this.stage.objective);
  }

  enterStage() {
    const stage = this.stage;
    if (!stage) return;
    if (stage.kind === 'defeat') {
      this.spawnGuards(stage);
    }
    if (stage.kind === 'escape') {
      // The ambush: the shell is told through onObjective's mission start;
      // the wanted level itself is raised by the shell hook below.
      if (this.onEscapeStage) this.onEscapeStage();
    }
  }

  spawnGuards(stage) {
    const [cx, cz] = stage.around;
    for (let i = 0; i < stage.count; i += 1) {
      const angle = (i / stage.count) * Math.PI * 2 + 0.6;
      const radius = stage.spread * (0.45 + (i % 3) * 0.24);
      const x = cx + Math.cos(angle) * radius;
      const z = cz + Math.sin(angle) * radius;
      const lieutenant = stage.lieutenant && i === 0;
      const guard = new SyndicateGuard(this.scene, this.city, this.weapons, new THREE.Vector3(x, 0, z), lieutenant ? 260 : 100);
      if (lieutenant) guard.figure.torso.material = guard.figure.torso.material.clone();
      if (lieutenant) guard.figure.torso.material.color.setHex(0xd8d8e0);
      guard.onDown = (downed) => this.guardDown(downed);
      this.guards.push(guard);
    }
    this.guardsLeft = this.guards.length;
  }

  guardDown(guard) {
    this.guardsLeft -= 1;
    const loot = 35 + Math.floor(Math.random() * 55);
    this.weapons.spawnCashPickup(guard.group.position, loot);
    if (Math.random() < 0.45) {
      this.weapons.spawnAmmoPickup(guard.group.position, Math.random() < 0.5 ? 'smg' : 'shotgun', 24);
    }
    if (this.onGuardDown) this.onGuardDown(guard);
    const stage = this.stage;
    if (stage && stage.kind === 'defeat' && this.onObjective) {
      this.onObjective(this.script.title, `Clear the Escorpion guards — ${this.guardsLeft} still standing.`);
    }
  }

  clearGuards() {
    for (const guard of this.guards) guard.dispose(this.scene, this.weapons);
    this.guards = [];
    this.guardsLeft = 0;
  }

  playDialogue(lines) {
    // Append, so a mission's outro lines are heard before the next intro.
    for (const [speaker, text] of lines) this.dialogueQueue.push({ speaker, text });
    if (this.dialogueTimer <= 0) this.dialogueTimer = 0.1;
  }

  finishMission(ctx) {
    const script = this.script;
    if (script) {
      ctx.player.addCash(script.reward);
      this.playDialogue(script.outro);
      if (this.onToast) this.onToast(`${script.title} complete — $${script.reward.toLocaleString()}`);
      if (this.onReward) this.onReward(script.reward);
    }
    const next = this.missionIndex + 1;
    if (next >= MISSION_SCRIPTS.length) {
      this.missionIndex = next;
      this.complete = true;
      this.contractStage = 0;
      if (this.onObjective) this.onObjective('Free Roam', 'Contract: deliver any car to Solis Customs for $300.');
      if (this.onCampaignComplete) this.onCampaignComplete();
    } else {
      this.begin(next);
    }
  }

  advanceStage(ctx) {
    this.stageIndex += 1;
    if (!this.stage) {
      this.finishMission(ctx);
      return;
    }
    this.enterStage();
    if (this.onObjective) this.onObjective(this.script.title, this.stage.objective);
  }

  /**
   * Watch the world and move the story. ctx: { playerPos, playerVehicle,
   * player, wanted, customsPad } where customsPad is the repaint bay box.
   */
  update(dt, ctx) {
    this.elapsed += dt;
    // Radio dialogue pacing: one line every ~3.6 s while the queue lasts.
    if (this.dialogueQueue.length) {
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0) {
        const line = this.dialogueQueue.shift();
        if (this.onDialogue) this.onDialogue(line.speaker, line.text);
        this.dialogueTimer = 3.6;
        if (!this.dialogueQueue.length) {
          // One extra beat, then the bar hides itself via the HUD timer.
          this.dialogueTimer = 3.6;
        }
      }
    }

    // Beacon placement and pulse.
    const target = this.targetPoint();
    if (target) {
      this.beacon.visible = true;
      this.beacon.position.x = target.x;
      this.beacon.position.z = target.z;
      this.beacon.position.y = this.city.groundHeightAt(target.x, target.z) + 17;
      const pulse = 0.26 + Math.sin(this.elapsed * 2.6) * 0.08;
      this.beacon.material.opacity = pulse;
      this.beaconLight.position.set(target.x, 3.5, target.z);
      this.beaconLight.intensity = 130 + Math.sin(this.elapsed * 2.6) * 40;
    } else {
      this.beacon.visible = false;
      this.beaconLight.intensity = 0;
    }

    for (const guard of this.guards) guard.update(dt, ctx.playerPos);

    if (this.complete) {
      this.updateContract(ctx);
      return;
    }
    const stage = this.stage;
    if (!stage) return;
    const playerPos = ctx.playerPos;
    switch (stage.kind) {
      case 'enterKind': {
        if (ctx.playerVehicle && ctx.playerVehicle.kind === stage.vehicleKind) this.advanceStage(ctx);
        break;
      }
      case 'driveTo': {
        if (ctx.playerVehicle && playerPos.distanceTo(new THREE.Vector3(stage.point[0], playerPos.y, stage.point[1])) < stage.radius) {
          this.advanceStage(ctx);
        }
        break;
      }
      case 'reach': {
        if (playerPos.distanceTo(new THREE.Vector3(stage.point[0], playerPos.y, stage.point[1])) < stage.radius) {
          this.advanceStage(ctx);
        }
        break;
      }
      case 'boatTo': {
        if (ctx.playerVehicle && ctx.playerVehicle.kind === 'boat'
          && playerPos.distanceTo(new THREE.Vector3(stage.point[0], playerPos.y, stage.point[1])) < stage.radius) {
          this.advanceStage(ctx);
        }
        break;
      }
      case 'defeat': {
        if (this.guardsLeft <= 0) this.advanceStage(ctx);
        break;
      }
      case 'escape': {
        if (ctx.wanted && ctx.wanted.stars === 0) this.advanceStage(ctx);
        break;
      }
      default:
        break;
    }
  }

  /** After the finale: an endless little earner to keep free roam purposeful. */
  updateContract(ctx) {
    if (this.contractStage === 0) {
      if (ctx.playerVehicle && ctx.playerVehicle.kind !== 'boat') {
        this.contractStage = 1;
        if (this.onObjective) this.onObjective('Free Roam', 'Contract: deliver the car to Solis Customs ($300).');
        if (this.onToast) this.onToast('Contract accepted — deliver the car to Solis Customs');
      }
      return;
    }
    const pad = ctx.customsPad;
    const p = ctx.playerPos;
    if (pad && p.x >= pad.minX && p.x <= pad.maxX && p.z >= pad.minZ && p.z <= pad.maxZ) {
      ctx.player.addCash(300);
      this.contractStage = 0;
      if (this.onToast) this.onToast('Contract delivered — $300');
      if (this.onReward) this.onReward(300);
      if (this.onObjective) this.onObjective('Free Roam', 'Contract: deliver any car to Solis Customs for $300.');
    }
  }
}
