// VehiclePhysicsAndTraffic — arcade vehicle physics shared by the player, traffic and the
// SPD: engine force along the heading, a velocity vector whose lateral part is gripped
// away (or kept, when the handbrake turns the car into a drift), speed-sensitive steering,
// building collisions with spark bursts, and a speedboat variant that lives on the water.
// On top of the physics sits the traffic fleet: citizen cars that hold their lane, brake
// for obstacles and turn at intersections, plus the parked cars waiting to be stolen.
import * as THREE from 'three';
import { CITY_LAYOUT } from '../world/SunsetCoastalCity.js';
import { createSeededRandom } from '../world/ProceduralCityTextures.js';

/** A pooled GPU point-particle system (drift smoke, collision sparks, boat foam). */
export class ParticleSystem {
  constructor(scene, texture, { capacity = 700, size = 1.6, color = 0xffffff, blending = THREE.NormalBlending, opacity = 0.55 } = {}) {
    this.capacity = capacity;
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.lives = new Float32Array(capacity);
    this.maxLives = new Float32Array(capacity);
    this.cursor = 0;
    this.gravity = -1.2;
    this.drag = 1.6;
    for (let i = 0; i < capacity; i += 1) this.positions[i * 3 + 1] = -999;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    const material = new THREE.PointsMaterial({
      map: texture, size, transparent: true, opacity, color,
      depthWrite: false, blending, sizeAttenuation: true,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, life) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.positions[i * 3] = x; this.positions[i * 3 + 1] = y; this.positions[i * 3 + 2] = z;
    this.velocities[i * 3] = vx; this.velocities[i * 3 + 1] = vy; this.velocities[i * 3 + 2] = vz;
    this.lives[i] = life;
    this.maxLives[i] = life;
  }

  burst(position, count, { speed = 3, up = 2.4, life = 0.7, spread = 1 } = {}) {
    for (let n = 0; n < count; n += 1) {
      const a = Math.random() * Math.PI * 2;
      const r = (0.3 + Math.random() * 0.7) * speed * spread;
      this.spawn(
        position.x, position.y + 0.3, position.z,
        Math.cos(a) * r, Math.random() * up, Math.sin(a) * r,
        life * (0.6 + Math.random() * 0.7),
      );
    }
  }

  update(dt) {
    const dragK = Math.max(0, 1 - this.drag * dt);
    for (let i = 0; i < this.capacity; i += 1) {
      if (this.lives[i] <= 0) continue;
      this.lives[i] -= dt;
      if (this.lives[i] <= 0) { this.positions[i * 3 + 1] = -999; continue; }
      this.velocities[i * 3 + 1] += this.gravity * dt;
      this.velocities[i * 3] *= dragK;
      this.velocities[i * 3 + 1] *= dragK;
      this.velocities[i * 3 + 2] *= dragK;
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export const VEHICLE_KINDS = {
  coupe: { label: 'Vulcano Coupe', maxSpeed: 39, accel: 17, grip: 8.5, turn: 2.0, radius: 1.7 },
  convertible: { label: 'Marina Roadster', maxSpeed: 35, accel: 15, grip: 8, turn: 2.0, radius: 1.7 },
  sedan: { label: 'Coral Sedan', maxSpeed: 28, accel: 11.5, grip: 9, turn: 1.8, radius: 1.75 },
  suv: { label: 'Brava SUV', maxSpeed: 27, accel: 11, grip: 9, turn: 1.7, radius: 1.85 },
  police: { label: 'SPD Interceptor', maxSpeed: 41, accel: 18, grip: 9.5, turn: 2.1, radius: 1.75 },
  boat: { label: 'Marina Speedboat', maxSpeed: 31, accel: 9.5, grip: 3.2, turn: 1.1, radius: 2.1 },
};

const CAR_PAINTS = [0xff4b33, 0xffa62b, 0x2bb3ff, 0xf2f2f2, 0x27c46b, 0xb04fd8, 0xff5f8f, 0x8892a0, 0x14304a];

export function createVehicleMesh(kind, color) {
  const group = new THREE.Group();
  const paint = new THREE.MeshPhongMaterial({ color, shininess: 90, specular: 0x886644 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x101623, shininess: 160, specular: 0xaaccff });
  const dark = new THREE.MeshLambertMaterial({ color: 0x17181f });
  const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); mesh.castShadow = true; group.add(mesh); return mesh; };

  if (kind === 'boat') {
    const hull = add(new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.85, 6.4), new THREE.MeshPhongMaterial({ color: 0xf4f6f8, shininess: 70 })), 0, 0.55, 0);
    hull.geometry.translate(0, 0, 0);
    const bow = add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 1.12, 2.2, 4), hull.material), 0, 0.55, 4.1);
    bow.rotation.x = Math.PI / 2;
    bow.rotation.y = Math.PI / 4;
    bow.scale.set(1, 1, 0.42);
    const stripe = add(new THREE.Mesh(new THREE.BoxGeometry(2.34, 0.22, 6.0), new THREE.MeshLambertMaterial({ color: 0xff5a3c })), 0, 0.78, -0.2);
    stripe.castShadow = false;
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.55, 0.14), glass), 0, 1.2, 1.15);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 2.4), new THREE.MeshLambertMaterial({ color: 0x2456a8 })), 0, 0.95, -1.2);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.4), dark), 0, 0.75, -3.4);
    group.userData.isBoat = true;
    return group;
  }

  const tall = kind === 'suv' ? 0.78 : 0.58;
  add(new THREE.Mesh(new THREE.BoxGeometry(1.9, tall, 4.35), paint), 0, 0.42 + tall / 2, 0);
  add(new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.16, 1.15), paint), 0, 0.62, 1.85); // hood
  if (kind === 'convertible') {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.34, 1.9), dark), 0, 1.06, -0.25);
    const shield = add(new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.5, 0.1), glass), 0, 1.2, 0.78);
    shield.rotation.x = -0.35;
  } else if (kind === 'suv') {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.78, 0.62, 3.1), glass), 0, 1.42, -0.2);
  } else {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.72, 0.52, 2.05), glass), 0, 1.24, -0.28);
  }
  if (kind === 'coupe') {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.09, 0.5), dark), 0, 1.18, -2.0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.3), dark), -0.7, 0.98, -2.0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.3, 0.3), dark), 0.7, 0.98, -2.0);
  }
  if (kind === 'police') {
    const doorL = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.7), new THREE.MeshLambertMaterial({ color: 0xf2f2f2 })), -0.96, 0.78, -0.2);
    const doorR = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.5, 1.7), doorL.material), 0.96, 0.78, -0.2);
    doorL.castShadow = doorR.castShadow = false;
    const bar = add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.13, 0.5), dark), 0, 1.58, -0.28);
    bar.castShadow = false;
    const red = new THREE.MeshBasicMaterial({ color: 0xff2a30 });
    const blue = new THREE.MeshBasicMaterial({ color: 0x2a6bff });
    const lampR = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.4), red), -0.34, 1.7, -0.28);
    const lampB = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.15, 0.4), blue), 0.34, 1.7, -0.28);
    lampR.castShadow = lampB.castShadow = false;
    group.userData.siren = { red, blue };
  }
  const wheelGeo = new THREE.CylinderGeometry(0.37, 0.37, 0.3, 12);
  const wheels = [];
  for (const [wx, wz] of [[-0.88, 1.38], [0.88, 1.38], [-0.88, -1.38], [0.88, -1.38]]) {
    const wheel = new THREE.Mesh(wheelGeo, dark);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(wx, 0.37, wz);
    group.add(wheel);
    wheels.push(wheel);
  }
  group.userData.wheels = wheels;
  group.userData.frontWheels = [wheels[0], wheels[1]];
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xffe9b0 });
  add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), lampMat), -0.62, 0.72, 2.2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.06), lampMat), 0.62, 0.72, 2.2);
  const tailMat = new THREE.MeshBasicMaterial({ color: 0x881118 });
  add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), tailMat), -0.62, 0.78, -2.2);
  add(new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.14, 0.06), tailMat), 0.62, 0.78, -2.2);
  group.userData.tailMaterial = tailMat;
  return group;
}

let vehicleSerial = 0;

export class Vehicle {
  constructor(kind, color, x, z, heading = 0) {
    this.id = (vehicleSerial += 1);
    this.kind = kind;
    this.spec = VEHICLE_KINDS[kind];
    this.label = this.spec.label;
    this.group = createVehicleMesh(kind, color);
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.velocity = new THREE.Vector3();
    this.verticalVelocity = 0;
    this.steerVisual = 0;
    this.parked = false;
    this.driver = null; // 'player' | 'traffic' | 'police' | 'parked'
    this.lastImpact = 0;
    this.drifting = false;
    this.inWater = kind === 'boat';
    this.syncMesh(0);
  }

  get position() { return this.group.position; }

  forward() { return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading)); }

  forwardSpeed() { return this.velocity.dot(this.forward()); }

  speedKmh() { return Math.abs(this.forwardSpeed()) * 3.6; }

  syncMesh(dt) {
    this.group.rotation.y = this.heading;
    const wheels = this.group.userData.wheels;
    if (wheels) {
      const spin = this.forwardSpeed() * dt / 0.37;
      for (const wheel of wheels) wheel.rotation.x += spin;
      for (const wheel of this.group.userData.frontWheels) wheel.rotation.y = this.steerVisual * 0.42;
    }
  }
}

/**
 * One arcade physics step, shared by player, traffic and police vehicles.
 * input: { throttle [-1..1], steer [-1..1], handbrake }. Returns impact strength (0 = none).
 */
export function stepVehiclePhysics(vehicle, dt, input, city, effects) {
  const spec = vehicle.spec;
  const pos = vehicle.position;
  const forward = vehicle.forward();
  const right = new THREE.Vector3(forward.z, 0, -forward.x);
  let fSpeed = vehicle.velocity.dot(forward);
  let rSpeed = vehicle.velocity.dot(right);

  if (input.throttle > 0) fSpeed += spec.accel * input.throttle * dt;
  else if (input.throttle < 0) fSpeed += (fSpeed > 0.6 ? -spec.accel * 1.4 : -spec.accel * 0.55) * -input.throttle * dt;
  fSpeed -= fSpeed * 0.35 * dt; // drag
  if (!input.throttle) fSpeed -= fSpeed * 1.4 * dt; // engine braking
  fSpeed = Math.max(-13, Math.min(spec.maxSpeed, fSpeed));

  const speedFactor = Math.max(-1, Math.min(1, fSpeed / 9));
  const turnBoost = input.handbrake ? 1.55 : 1;
  vehicle.heading -= input.steer * spec.turn * turnBoost * speedFactor * dt * (vehicle.kind === 'boat' ? 0.8 : 1);
  vehicle.steerVisual += (input.steer - vehicle.steerVisual) * Math.min(1, dt * 9);

  const grip = input.handbrake ? spec.grip * 0.24 : spec.grip;
  rSpeed *= Math.exp(-grip * dt);
  vehicle.drifting = input.handbrake && Math.abs(fSpeed) > 8;

  const newForward = vehicle.forward();
  const newRight = new THREE.Vector3(newForward.z, 0, -newForward.x);
  vehicle.velocity.copy(newForward).multiplyScalar(fSpeed).addScaledVector(newRight, rSpeed);

  const nextX = pos.x + vehicle.velocity.x * dt;
  const nextZ = pos.z + vehicle.velocity.z * dt;
  const onWater = city.isWater(nextX, nextZ);
  if (vehicle.kind === 'boat') {
    if (!onWater && city.groundHeightAt(nextX, nextZ) <= 0 && nextX < CITY_LAYOUT.shoreX + 4) {
      vehicle.velocity.multiplyScalar(0.4); // beached on the sand edge
    } else { pos.x = nextX; pos.z = nextZ; }
  } else if (onWater) {
    vehicle.velocity.multiplyScalar(0.3); // the shore stops cars
  } else {
    pos.x = nextX; pos.z = nextZ;
  }

  // Ground following + ramp airtime.
  const groundY = vehicle.kind === 'boat' ? -0.15 : city.groundHeightAt(pos.x, pos.z);
  if (pos.y > groundY + 0.04) {
    vehicle.verticalVelocity -= 24 * dt;
    pos.y += vehicle.verticalVelocity * dt;
    if (pos.y <= groundY) { pos.y = groundY; vehicle.verticalVelocity = 0; }
  } else {
    pos.y = groundY;
    vehicle.verticalVelocity = 0;
  }
  if (vehicle.kind === 'boat') pos.y = -0.15 + Math.sin(performance.now() * 0.0016 + vehicle.id) * 0.07;

  let impact = 0;
  if (vehicle.kind !== 'boat') {
    const before = vehicle.velocity.length();
    if (city.resolveCircle(pos, spec.radius)) {
      const after = vehicle.velocity.length();
      impact = Math.max(0, before - after) + (before > 5 ? 2.2 : 0);
      vehicle.velocity.multiplyScalar(0.45);
      if (effects && impact > 2.4) effects.sparks.burst(pos, 10, { speed: 4, life: 0.4 });
    }
  }
  vehicle.lastImpact = impact;

  // Drift smoke from the rear wheels; foam from the boat's stern.
  if (effects) {
    if (vehicle.drifting) {
      const back = pos.clone().addScaledVector(newForward, -1.6);
      effects.smoke.spawn(back.x, pos.y + 0.25, back.z, (Math.random() - 0.5), 1.1, (Math.random() - 0.5), 0.8);
      effects.smoke.spawn(back.x, pos.y + 0.25, back.z, (Math.random() - 0.5), 1.3, (Math.random() - 0.5), 0.9);
    }
    if (vehicle.kind === 'boat' && Math.abs(fSpeed) > 4) {
      const stern = pos.clone().addScaledVector(newForward, -3.4);
      effects.smoke.spawn(stern.x, 0.15, stern.z, (Math.random() - 0.5) * 1.6, 0.7, (Math.random() - 0.5) * 1.6, 0.7);
    }
  }
  vehicle.syncMesh(dt);
  return impact;
}

/** The citizen fleet: parked cars to steal and traffic that obeys its lanes. */
export class VehiclePhysicsAndTraffic {
  constructor(scene, city, effects, textures) {
    this.city = city;
    this.effects = effects;
    this.random = createSeededRandom(4451);
    this.vehicles = [];
    this.traffic = [];
    const rng = this.random;

    // Parked cars along the boulevard, downtown streets and the harbour road.
    const parkedSpots = [
      ['coupe', 105.5, 132, Math.PI], ['convertible', -26, 46.5, Math.PI / 2], ['sedan', 46.5, -26, 0],
      ['suv', -86.5, 106, Math.PI], ['sedan', 105.5, -60, 0], ['coupe', -146, -13.5, Math.PI / 2],
      ['convertible', 105.5, 190, Math.PI], ['sedan', -13.5, -146, 0], ['suv', 33.5, 166, Math.PI / 2],
      ['sedan', -206, 33.5, 0], ['coupe', 105.5, -150, Math.PI], ['suv', -73.5, -86, 0],
    ];
    for (const [kind, x, z, heading] of parkedSpots) {
      const v = new Vehicle(kind, CAR_PAINTS[Math.floor(rng() * CAR_PAINTS.length)], x, z, heading);
      v.parked = true;
      v.driver = 'parked';
      scene.add(v.group);
      this.vehicles.push(v);
    }
    // The Marina Speedboat waiting at the end of Playa Coral Pier.
    this.boat = new Vehicle('boat', 0xffffff, 216, 23, Math.PI / 2);
    this.boat.parked = true;
    this.boat.driver = 'parked';
    scene.add(this.boat.group);
    this.vehicles.push(this.boat);

    // Traffic fleet.
    const kinds = ['sedan', 'suv', 'convertible', 'coupe', 'sedan', 'suv', 'sedan', 'convertible', 'sedan', 'suv', 'coupe', 'sedan'];
    for (let i = 0; i < kinds.length; i += 1) {
      const v = new Vehicle(kinds[i], CAR_PAINTS[Math.floor(rng() * CAR_PAINTS.length)], 0, 0, 0);
      v.driver = 'traffic';
      this.placeTrafficCar(v, null, true);
      scene.add(v.group);
      this.vehicles.push(v);
      this.traffic.push(v);
    }
    this.textures = textures;
  }

  laneOffsetFor(axis, dirSign) {
    // Right-hand traffic: the lane sits to the right of the direction of travel.
    return dirSign > 0 ? -3.4 : 3.4;
  }

  placeTrafficCar(v, near, anywhere = false) {
    const rng = this.random;
    const L = CITY_LAYOUT;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const vertical = rng() < 0.55;
      const dirSign = rng() < 0.5 ? 1 : -1;
      if (vertical) {
        const roadX = L.roadXs[Math.floor(rng() * L.roadXs.length)];
        const z = near ? near.z + (rng() - 0.5) * 260 : -250 + rng() * 500;
        v.position.set(roadX + (roadX === L.boulevardX ? this.laneOffsetFor('z', dirSign) * 1.4 : this.laneOffsetFor('z', dirSign)), 0, Math.max(-255, Math.min(255, z)));
        v.heading = dirSign > 0 ? 0 : Math.PI;
        v.route = { axis: 'z', fixed: v.position.x, dirSign };
      } else {
        const roadZ = L.roadZs[Math.floor(rng() * L.roadZs.length)];
        const x = near ? near.x + (rng() - 0.5) * 260 : -250 + rng() * 380;
        v.position.set(Math.max(-255, Math.min(130, x)), 0, roadZ + this.laneOffsetFor('x', dirSign));
        v.heading = dirSign > 0 ? Math.PI / 2 : -Math.PI / 2;
        v.route = { axis: 'x', fixed: v.position.z, dirSign };
      }
      v.velocity.set(0, 0, 0);
      v.cruiseSpeed = 10.5 + rng() * 4.5;
      let clear = true;
      for (const other of this.vehicles) {
        if (other !== v && other.position.distanceTo(v.position) < 9) { clear = false; break; }
      }
      if (clear || anywhere) return;
    }
  }

  /** Obstacle scan for a traffic car: anything solid in the lane just ahead. */
  obstacleAhead(v, allVehicles, playerPos, playerVehicle) {
    const f = v.forward();
    const probe = (target, radius) => {
      const dx = target.x - v.position.x;
      const dz = target.z - v.position.z;
      const ahead = dx * f.x + dz * f.z;
      if (ahead < 0.5 || ahead > 9.5) return false;
      const side = Math.abs(dx * f.z - dz * f.x);
      return side < radius;
    };
    for (const other of allVehicles) {
      if (other === v) continue;
      if (probe(other.position, 2.4)) return true;
    }
    if (playerVehicle !== v && playerPos && probe(playerPos, 2.2)) return true;
    return false;
  }

  update(dt, playerPos, playerVehicle) {
    const L = CITY_LAYOUT;
    for (const v of this.traffic) {
      if (v.driver !== 'traffic') continue;
      // Respawn far-away traffic near the player so the streets always feel alive.
      if (playerPos && v.position.distanceTo(playerPos) > 250) {
        this.placeTrafficCar(v, playerPos);
        continue;
      }
      const route = v.route;
      const fSpeed = v.forwardSpeed();
      // Intersection turns.
      const crossings = route.axis === 'z' ? L.roadZs : L.roadXs;
      const along = route.axis === 'z' ? v.position.z : v.position.x;
      for (const cross of crossings) {
        if (Math.abs(along - cross) < 1.6 && this.random() < 0.006) {
          const dirSign = this.random() < 0.5 ? 1 : -1;
          if (route.axis === 'z') {
            v.route = { axis: 'x', fixed: cross + this.laneOffsetFor('x', dirSign), dirSign };
            v.position.z = v.route.fixed;
          } else {
            v.route = { axis: 'z', fixed: cross + this.laneOffsetFor('z', dirSign), dirSign };
            v.position.x = v.route.fixed;
          }
          break;
        }
      }
      const r2 = v.route;
      const targetPoint = r2.axis === 'z'
        ? new THREE.Vector3(r2.fixed, 0, v.position.z + r2.dirSign * 14)
        : new THREE.Vector3(v.position.x + r2.dirSign * 14, 0, r2.fixed);
      const targetHeading = Math.atan2(targetPoint.x - v.position.x, targetPoint.z - v.position.z);
      let diff = targetHeading - v.heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const steer = Math.max(-1, Math.min(1, -diff * 2.4)); // physics turns heading down for +steer
      const blocked = this.obstacleAhead(v, this.vehicles, playerPos, playerVehicle);
      let throttle = 0;
      if (blocked) throttle = fSpeed > 1 ? -1 : 0;
      else throttle = Math.max(-0.6, Math.min(1, (v.cruiseSpeed - fSpeed) * 0.25));
      stepVehiclePhysics(v, dt, { throttle, steer, handbrake: false }, this.city, null);
    }
  }

  nearestVehicle(position, maxDistance = 3.6) {
    let best = null;
    let bestDist = maxDistance;
    for (const v of this.vehicles) {
      const d = v.position.distanceTo(position);
      if (d < bestDist) { bestDist = d; best = v; }
    }
    return best;
  }

  removeFromTraffic(vehicle) {
    const i = this.traffic.indexOf(vehicle);
    if (i >= 0) this.traffic.splice(i, 1);
  }
}
