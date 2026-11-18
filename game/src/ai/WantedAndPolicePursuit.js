// WantedAndPolicePursuit — the SPD Task Force's answer to Val's evening.
// Crimes feed a heat meter; heat reads out as one to five wanted stars. The
// pursuit director keeps a star-scaled fleet of Interceptors on the road
// (spawned on the road grid just out of sight, retired when they fall too far
// behind), steers each one at the player's predicted position with the shared
// arcade physics, flashes every light bar, and — from four stars — puts a
// helicopter with a searchlight cone over the chase. Officers open fire from
// three stars. Stay out of every unit's sight long enough and the stars cool
// and die; get cornered on foot and the bust meter fills instead.
import * as THREE from 'three';
import { Vehicle, stepVehiclePhysics } from '../vehicles/VehiclePhysicsAndTraffic.js';
import { CITY_LAYOUT } from '../world/SunsetCoastalCity.js';

const HEAT_FOR_STAR = [0, 20, 75, 160, 280, 430];
const UNITS_FOR_STAR = [0, 1, 2, 3, 4, 5];
const CRIME_HEAT = {
  gunfire: 12,
  gunfireHit: 20,
  assault: 16,
  hijack: 30,
  citizenDown: 42,
  guardDown: 34,
  officerDown: 85,
  policeWrecked: 55,
  ramming: 7,
};

export class WantedAndPolicePursuit {
  constructor(scene, city, effects, weapons) {
    this.scene = scene;
    this.city = city;
    this.effects = effects;
    this.weapons = weapons;
    this.heat = 0;
    this.stars = 0;
    this.mode = 'clean'; // clean | chased | cooling
    this.units = [];
    this.sightTimer = 0;
    this.spawnTimer = 0;
    this.bustMeter = 0;
    this.elapsed = 0;
    this.heli = null;
    this.onBusted = null; // () => void
    this.onStarsChanged = null; // (stars) => void
    this.onPlayerDamage = null; // (amount) => void — routed from officer fire
    if (this.weapons) {
      this.weapons.onPlayerHit = (damage) => {
        if (this.onPlayerDamage) this.onPlayerDamage(damage);
      };
    }
  }

  /** Feed a crime into the heat meter. Unknown kinds are ignored. */
  reportCrime(kind, position) {
    const value = CRIME_HEAT[kind];
    if (!value) return;
    // A crime only counts when someone could plausibly report it: near a
    // road, a citizen, or an existing unit. Deep water and rooftops are safe.
    this.addHeat(value);
  }

  addHeat(value) {
    this.heat = Math.min(560, this.heat + value);
    this.refreshStars();
  }

  /** Force an exact star level (the campaign's ambush mission uses this). */
  setStars(count) {
    this.heat = HEAT_FOR_STAR[Math.max(0, Math.min(5, count))];
    this.refreshStars();
    this.sightTimer = 0;
    if (count > 0) this.mode = 'chased';
  }

  clearWanted() {
    this.heat = 0;
    this.refreshStars();
    this.mode = 'clean';
    this.sightTimer = 0;
    this.bustMeter = 0;
  }

  refreshStars() {
    let stars = 0;
    for (let i = 1; i <= 5; i += 1) if (this.heat >= HEAT_FOR_STAR[i]) stars = i;
    if (stars !== this.stars) {
      this.stars = stars;
      if (this.onStarsChanged) this.onStarsChanged(stars);
    }
    if (this.stars === 0) this.mode = 'clean';
  }

  nearestPoliceDistance(position) {
    let best = Infinity;
    for (const unit of this.units) {
      if (unit.wrecked) continue;
      best = Math.min(best, unit.vehicle.position.distanceTo(position));
    }
    return best;
  }

  anyUnitSees(playerPos) {
    for (const unit of this.units) {
      if (unit.wrecked) continue;
      if (unit.vehicle.position.distanceTo(playerPos) < 58) return true;
    }
    return this.heli && this.stars >= 4 && this.heli.group.position.distanceTo(playerPos) < 85;
  }

  spawnPointNear(playerPos) {
    const L = CITY_LAYOUT;
    const rng = Math.random;
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const vertical = rng() < 0.5;
      let x;
      let z;
      let heading;
      if (vertical) {
        x = L.roadXs[Math.floor(rng() * L.roadXs.length)];
        z = playerPos.z + (rng() < 0.5 ? -1 : 1) * (58 + rng() * 26);
        heading = z < playerPos.z ? 0 : Math.PI;
      } else {
        z = L.roadZs[Math.floor(rng() * L.roadZs.length)];
        x = playerPos.x + (rng() < 0.5 ? -1 : 1) * (58 + rng() * 26);
        heading = x < playerPos.x ? Math.PI / 2 : -Math.PI / 2;
      }
      x = Math.max(-252, Math.min(140, x));
      z = Math.max(-252, Math.min(252, z));
      if (Math.hypot(x - playerPos.x, z - playerPos.z) < 46) continue;
      if (this.city.isWater(x, z)) continue;
      return { x, z, heading };
    }
    return { x: playerPos.x - 60, z: playerPos.z, heading: Math.PI / 2 };
  }

  spawnUnit(playerPos) {
    const point = this.spawnPointNear(playerPos);
    const vehicle = new Vehicle('police', 0x16181f, point.x, point.z, point.heading);
    vehicle.driver = 'police';
    this.scene.add(vehicle.group);
    const lamp = new THREE.PointLight(0xff2a30, 26, 19, 1.7);
    lamp.position.set(0, 2.1, 0);
    vehicle.group.add(lamp);
    const unit = {
      vehicle, health: 170, wrecked: false, shootTimer: 1 + Math.random() * 1.4, lamp, phase: Math.random() * 10,
    };
    if (this.weapons) {
      unit.hittable = this.weapons.registerHittable({
        getPosition: () => vehicle.position,
        radius: 2.0,
        centreHeight: 0.8,
        kind: 'police',
        onHit: (damage) => this.damageUnit(unit, damage),
      });
    }
    this.units.push(unit);
    return unit;
  }

  damageUnit(unit, damage) {
    if (unit.wrecked) return;
    unit.health -= damage;
    this.addHeat(6);
    if (unit.health <= 0) {
      unit.wrecked = true;
      unit.vehicle.driver = 'parked';
      unit.vehicle.parked = true;
      unit.lamp.intensity = 0;
      if (this.effects) this.effects.smoke.burst(unit.vehicle.position, 16, { speed: 2.4, life: 1.1 });
      this.addHeat(CRIME_HEAT.policeWrecked);
    }
  }

  retireUnit(unit) {
    this.scene.remove(unit.vehicle.group);
    if (this.weapons && unit.hittable) this.weapons.unregisterHittable(unit.hittable);
    const i = this.units.indexOf(unit);
    if (i >= 0) this.units.splice(i, 1);
  }

  buildHelicopter() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshLambertMaterial({ color: 0x1d2733 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.7, 5.6), bodyMat);
    group.add(body);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 4.6), bodyMat);
    tail.position.set(0, 0.25, -4.6);
    group.add(tail);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.3, 0.7), new THREE.MeshLambertMaterial({ color: 0xff8c42 }));
    fin.position.set(0, 0.7, -6.7);
    group.add(fin);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.06, 0.5), new THREE.MeshBasicMaterial({ color: 0x11131a }));
    rotor.position.y = 1.25;
    group.add(rotor);
    const skidMat = new THREE.MeshLambertMaterial({ color: 0x39424f });
    for (const sx of [-1.05, 1.05]) {
      const skid = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 3.6), skidMat);
      skid.position.set(sx, -1.25, 0);
      group.add(skid);
    }
    const spot = new THREE.SpotLight(0xfff2cf, 900, 130, 0.3, 0.45, 1.1);
    spot.position.set(0, -0.8, 0);
    group.add(spot);
    group.add(spot.target);
    const cone = new THREE.Mesh(
      new THREE.CylinderGeometry(1.4, 9.5, 36, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffedb8, transparent: true, opacity: 0.13, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
      }),
    );
    cone.position.y = -18.5;
    group.add(cone);
    group.visible = false;
    this.scene.add(group);
    return { group, rotor, spot, cone };
  }

  /**
   * Advance the whole pursuit. ctx: { playerPos, playerVehicle, playerSpeed,
   * playerAlive, active } — `active` is false while menus are open.
   */
  update(dt, ctx) {
    this.elapsed += dt;
    const { playerPos, playerVehicle } = ctx;

    // Sight & cooling bookkeeping.
    if (this.stars > 0) {
      if (this.anyUnitSees(playerPos)) {
        this.sightTimer = 0;
        this.mode = 'chased';
      } else {
        this.sightTimer += dt;
        this.mode = 'cooling';
        const escapeAfter = 6.5 + this.stars * 2.4;
        if (this.sightTimer > escapeAfter) this.clearWanted();
      }
    }

    // Fleet size follows the stars; new units arrive on a short cadence.
    this.spawnTimer -= dt;
    const wanted = UNITS_FOR_STAR[this.stars];
    const live = this.units.filter((u) => !u.wrecked).length;
    if (ctx.active && this.stars > 0 && live < wanted && this.spawnTimer <= 0) {
      this.spawnUnit(playerPos);
      this.spawnTimer = 1.6;
    }
    // Retire units that lost the trail completely or when the heat dies.
    for (let i = this.units.length - 1; i >= 0; i -= 1) {
      const unit = this.units[i];
      const dist = unit.vehicle.position.distanceTo(playerPos);
      if ((this.stars === 0 && dist > 26) || dist > 190) this.retireUnit(unit);
    }

    // Drive and animate every unit.
    for (const unit of this.units) {
      const vehicle = unit.vehicle;
      // Light bar: alternate red/blue, plus the roof point light in step.
      const siren = vehicle.group.userData.siren;
      if (siren && !unit.wrecked) {
        const phase = Math.floor((this.elapsed + unit.phase) * 5.5) % 2;
        siren.red.color.setHex(phase === 0 ? 0xff2a30 : 0x4d0d10);
        siren.blue.color.setHex(phase === 0 ? 0x0d1c4d : 0x2a6bff);
        unit.lamp.color.setHex(phase === 0 ? 0xff2a30 : 0x2a6bff);
        unit.lamp.intensity = 24 + Math.sin(this.elapsed * 22 + unit.phase) * 7;
      }
      if (unit.wrecked || !ctx.active) continue;

      // Aim at where the player will be, not where they are.
      const lead = playerVehicle ? playerVehicle.velocity.clone().multiplyScalar(0.45) : new THREE.Vector3();
      const target = playerPos.clone().add(lead);
      const distToPlayer = vehicle.position.distanceTo(playerPos);
      const toTarget = Math.atan2(target.x - vehicle.position.x, target.z - vehicle.position.z);
      let diff = toTarget - vehicle.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = Math.max(-1, Math.min(1, -diff * 2.6));
      let throttle = 1;
      if (!playerVehicle && distToPlayer < 5.5) throttle = 0.1; // officers close in on foot targets carefully
      if (distToPlayer < 2.6 && !playerVehicle) throttle = -0.4;
      stepVehiclePhysics(vehicle, dt, { throttle, steer, handbrake: Math.abs(diff) > 2.2 }, this.city, this.effects);

      // Officer fire from three stars, once they are alongside.
      if (this.weapons && this.stars >= 3 && distToPlayer < 30) {
        unit.shootTimer -= dt;
        if (unit.shootTimer <= 0) {
          unit.shootTimer = 1.5 + Math.random() * 1.3;
          const from = vehicle.position.clone();
          from.y += 0.6;
          this.weapons.enemyFire(from, playerPos, { damage: playerVehicle ? 3.5 : 6, range: 32, tracerColor: 0xffb27a });
        }
      }
    }

    // The bust meter: cornered on foot with a unit right on top of Val.
    if (ctx.active && !playerVehicle && this.stars > 0 && ctx.playerAlive) {
      const nearest = this.nearestPoliceDistance(playerPos);
      if (nearest < 3.4 && (ctx.playerSpeed ?? 0) < 2.2) {
        this.bustMeter += dt;
        if (this.bustMeter > 2.2) {
          this.bustMeter = 0;
          this.clearWanted();
          if (this.onBusted) this.onBusted();
        }
      } else {
        this.bustMeter = Math.max(0, this.bustMeter - dt * 1.6);
      }
    }

    // Helicopter at four-plus stars: a circling spotlight over the player.
    if (this.stars >= 4 && ctx.active) {
      if (!this.heli) this.heli = this.buildHelicopter();
      this.heli.group.visible = true;
      const h = this.heli;
      const orbit = this.elapsed * 0.35;
      h.group.position.set(
        playerPos.x + Math.cos(orbit) * 13,
        33 + Math.sin(this.elapsed * 0.8) * 1.6,
        playerPos.z + Math.sin(orbit) * 13,
      );
      h.group.rotation.y = -orbit + Math.PI / 2;
      h.rotor.rotation.y += dt * 28;
      h.spot.target.position.set(playerPos.x - h.group.position.x, -33, playerPos.z - h.group.position.z);
      h.spot.target.updateMatrixWorld();
    } else if (this.heli) {
      this.heli.group.visible = false;
    }
  }
}
