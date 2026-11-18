// PlayerCharacterController — Valeria "Val" Mendoza as an articulated low-poly figure
// (head, torso, swinging arms and legs), third-person movement relative to the camera,
// sprinting, health/armour/cash state, and the hand that holds the current weapon prop.
import * as THREE from 'three';

const WALK_SPEED = 5.2;
const SPRINT_SPEED = 9.0;

export class PlayerCharacterController {
  constructor(scene, city) {
    this.city = city;
    this.radius = 0.55;
    this.health = 100;
    this.armor = 0;
    this.cash = 250;
    this.alive = true;
    this.aiming = false;
    this.speedNow = 0;
    this.walkPhase = 0;
    this.heading = Math.PI / 2; // facing the sunrise over the water at spawn
    this.group = this.buildFigure();
    this.group.position.set(110, 0, 150);
    scene.add(this.group);
  }

  buildFigure() {
    const group = new THREE.Group();
    group.name = 'ValMendoza';
    const skin = new THREE.MeshLambertMaterial({ color: 0xc98a5e });
    const jacket = new THREE.MeshLambertMaterial({ color: 0xff5a3c });
    const denim = new THREE.MeshLambertMaterial({ color: 0x2c3e70 });
    const dark = new THREE.MeshLambertMaterial({ color: 0x1c1c22 });

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.85, 0.42), jacket);
    torso.position.y = 1.28;
    group.add(torso);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.44, 0.42), skin);
    head.position.y = 1.94;
    group.add(head);
    const hair = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.2, 0.46), new THREE.MeshLambertMaterial({ color: 0x2a1608 }));
    hair.position.y = 2.14;
    group.add(hair);
    const ponytail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.5, 0.16), hair.material);
    ponytail.position.set(0, 1.86, -0.26);
    group.add(ponytail);

    const limb = (w, h, d, material) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      geometry.translate(0, -h / 2, 0);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.castShadow = true;
      return mesh;
    };
    this.armL = limb(0.24, 0.78, 0.26, jacket);
    this.armL.position.set(-0.52, 1.66, 0);
    group.add(this.armL);
    this.armR = limb(0.24, 0.78, 0.26, jacket);
    this.armR.position.set(0.52, 1.66, 0);
    group.add(this.armR);
    this.legL = limb(0.3, 0.86, 0.32, denim);
    this.legL.position.set(-0.2, 0.88, 0);
    group.add(this.legL);
    this.legR = limb(0.3, 0.86, 0.32, denim);
    this.legR.position.set(0.2, 0.88, 0);
    group.add(this.legR);

    // The weapon prop rides in the right hand; hidden while unarmed or driving.
    this.weaponProp = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.16, 0.52), dark);
    this.weaponProp.position.set(0, -0.82, 0.18);
    this.weaponProp.visible = false;
    this.armR.add(this.weaponProp);

    group.traverse((node) => { if (node.isMesh) node.castShadow = true; });
    return group;
  }

  get position() {
    return this.group.position;
  }

  setWeaponProp(kind) {
    this.weaponProp.visible = kind !== 'unarmed' && kind !== null;
    if (kind === 'shotgun') this.weaponProp.scale.set(1.2, 1.2, 1.7);
    else if (kind === 'smg') this.weaponProp.scale.set(1, 1, 1.25);
    else this.weaponProp.scale.set(1, 1, 1);
  }

  /** Move on foot. `input` is camera-relative: forward/strafe in [-1, 1], sprint a boolean. */
  update(dt, input, cameraYaw) {
    if (!this.alive) return;
    const moving = Math.abs(input.forward) > 0.01 || Math.abs(input.strafe) > 0.01;
    const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
    let vx = 0;
    let vz = 0;
    if (moving) {
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      // camera looks toward -forward; build the wish direction on the ground plane
      let dx = (-sin * input.forward) + (cos * input.strafe);
      let dz = (-cos * input.forward) + (-sin * input.strafe);
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      vx = dx * speed;
      vz = dz * speed;
      if (!this.aiming) {
        const targetHeading = Math.atan2(dx, dz);
        let diff = targetHeading - this.heading;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.heading += diff * Math.min(1, dt * 12);
      }
    }
    if (this.aiming) this.heading = cameraYaw + Math.PI;

    const pos = this.group.position;
    const nextX = pos.x + vx * dt;
    const nextZ = pos.z + vz * dt;
    // The sea is out of bounds on foot (piers and the beach are fine).
    if (!this.city.isWater(nextX, nextZ) || this.city.groundHeightAt(nextX, nextZ) > 0) {
      pos.x = nextX;
      pos.z = nextZ;
    }
    pos.x = Math.max(-262, Math.min(235, pos.x));
    pos.z = Math.max(-262, Math.min(262, pos.z));
    this.city.resolveCircle(pos, this.radius);
    pos.y = this.city.groundHeightAt(pos.x, pos.z);

    this.speedNow = Math.hypot(vx, vz);
    this.walkPhase += dt * this.speedNow * 1.9;
    const swing = Math.sin(this.walkPhase) * Math.min(1, this.speedNow / WALK_SPEED) * 0.62;
    if (this.aiming) {
      this.armR.rotation.x = -Math.PI / 2 + 0.12;
      this.armL.rotation.x = -Math.PI / 2 + 0.3;
      this.legL.rotation.x = swing * 0.3;
      this.legR.rotation.x = -swing * 0.3;
    } else {
      this.legL.rotation.x = swing;
      this.legR.rotation.x = -swing;
      this.armL.rotation.x = -swing * 0.8;
      this.armR.rotation.x = swing * 0.8;
    }
    this.group.rotation.y = this.heading;
  }

  /** Apply damage: armour soaks 60% until it is gone. Returns true when Val goes down. */
  damage(amount) {
    if (!this.alive) return false;
    let remaining = amount;
    if (this.armor > 0) {
      const soaked = Math.min(this.armor, amount * 0.6);
      this.armor -= soaked;
      remaining -= soaked;
    }
    this.health -= remaining;
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.group.rotation.x = -Math.PI / 2;
      this.group.position.y = 0.3;
      return true;
    }
    return false;
  }

  heal(amount) {
    this.health = Math.min(100, this.health + amount);
  }

  respawn(position) {
    this.alive = true;
    this.health = 100;
    this.group.rotation.x = 0;
    this.group.position.copy(position);
    this.group.position.y = this.city.groundHeightAt(position.x, position.z);
  }

  addCash(amount) {
    this.cash += amount;
    return this.cash;
  }
}
