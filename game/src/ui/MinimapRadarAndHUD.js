// MinimapRadarAndHUD — everything the player reads while driving Puerto Solis.
// The radar is a live 2D canvas: coastline and sea, the road grid, building
// footprints, traffic as pale dots, SPD units blinking red/blue, syndicate
// guards in red, a dashed gold route line to the mission beacon, and Val's
// arrow in the centre. Around it, this module owns the DOM HUD: wanted stars
// (lit, cooling, or flashing under pursuit), cash, weapon and ammunition,
// health and armour bars, the district label, the interact prompt, the radio
// subtitle bar, centre toasts, the crosshair and the damage vignette.
import { CITY_LAYOUT } from '../world/SunsetCoastalCity.js';

const RADAR_RANGE = 125; // world units from the player to the radar's edge

export class MinimapRadarAndHUD {
  constructor() {
    this.minimap = document.getElementById('hud-minimap-canvas');
    this.mapCtx = this.minimap.getContext('2d');
    this.districtLabel = document.getElementById('hud-district-label');
    this.starsBox = document.getElementById('hud-wanted-stars');
    this.starEls = [...this.starsBox.querySelectorAll('.star')];
    this.cashEl = document.getElementById('hud-cash-display');
    this.weaponNameEl = document.getElementById('hud-weapon-name');
    this.weaponAmmoEl = document.getElementById('hud-weapon-ammo');
    this.healthBar = document.getElementById('hud-health-bar');
    this.armorBar = document.getElementById('hud-armor-bar');
    this.missionTitleEl = document.getElementById('hud-mission-title');
    this.missionObjectiveEl = document.getElementById('hud-mission-objective');
    this.promptEl = document.getElementById('hud-interact-prompt');
    this.dialogueBar = document.getElementById('hud-dialogue-bar');
    this.dialogueSpeaker = document.getElementById('hud-dialogue-speaker');
    this.dialogueText = document.getElementById('hud-dialogue-text');
    this.toastEl = document.getElementById('hud-centre-toast');
    this.crosshairEl = document.getElementById('hud-crosshair');
    this.vignetteEl = document.getElementById('hud-damage-vignette');
    this.dialogueTimer = 0;
    this.toastTimer = 0;
    this.vignette = 0;
    this.elapsed = 0;
    this.lastDistrict = '';
  }

  setMission(title, objective) {
    if (title) this.missionTitleEl.textContent = title;
    if (objective) this.missionObjectiveEl.textContent = objective;
  }

  showDialogue(speaker, text, seconds = 3.8) {
    if (!speaker) {
      this.dialogueBar.classList.remove('show');
      this.dialogueTimer = 0;
      return;
    }
    this.dialogueSpeaker.textContent = speaker;
    this.dialogueText.textContent = text;
    this.dialogueBar.classList.add('show');
    this.dialogueTimer = seconds;
  }

  toast(text, seconds = 2.8) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  setPrompt(text) {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.classList.add('show');
    } else {
      this.promptEl.classList.remove('show');
    }
  }

  flashDamage() {
    this.vignette = Math.min(1, this.vignette + 0.55);
  }

  /**
   * Refresh everything for this frame. ctx carries the live game objects:
   * { player, playerVehicle, playerHeading, weapons, wanted, fleet, police,
   *   guards, missionTarget, city, aiming }
   */
  update(dt, ctx) {
    this.elapsed += dt;
    if (this.dialogueTimer > 0) {
      this.dialogueTimer -= dt;
      if (this.dialogueTimer <= 0) this.dialogueBar.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
    if (this.vignette > 0) {
      this.vignette = Math.max(0, this.vignette - dt * 1.5);
      this.vignetteEl.style.opacity = String(this.vignette * 0.9);
    }

    const { player, weapons, wanted } = ctx;
    // Stars.
    for (let i = 0; i < this.starEls.length; i += 1) {
      const el = this.starEls[i];
      el.classList.toggle('lit', i < wanted.stars);
      el.classList.toggle('cooling', wanted.mode === 'cooling' && i < wanted.stars);
    }
    this.starsBox.classList.toggle('chased', wanted.mode === 'chased');
    // Cash, weapon, vitals.
    this.cashEl.textContent = `$${player.cash.toLocaleString()}`;
    this.weaponNameEl.textContent = weapons.weapon.name;
    this.weaponAmmoEl.textContent = weapons.weapon.ammo === Infinity ? '' : weapons.ammoText();
    this.healthBar.style.width = `${Math.max(0, player.health)}%`;
    this.armorBar.style.width = `${Math.max(0, player.armor)}%`;
    this.crosshairEl.classList.toggle('show', !!ctx.aiming);
    // District (of the car when driving, of Val when on foot).
    const anchorPos = ctx.playerPos || player.position;
    const district = ctx.city.districtAt(anchorPos.x, anchorPos.z);
    if (district !== this.lastDistrict) {
      this.lastDistrict = district;
      this.districtLabel.textContent = district;
    }
    this.drawRadar(ctx);
  }

  drawRadar(ctx) {
    const g = this.mapCtx;
    const size = this.minimap.width;
    const centre = size / 2;
    const scale = centre / RADAR_RANGE;
    const anchorPos = ctx.playerPos || ctx.player.position;
    const px = anchorPos.x;
    const pz = anchorPos.z;
    const toMapX = (x) => centre + (x - px) * scale;
    const toMapY = (z) => centre + (z - pz) * scale;

    g.clearRect(0, 0, size, size);
    // Sea first, then the landmass west of the shoreline, then the sand edge.
    g.fillStyle = '#274b73';
    g.fillRect(0, 0, size, size);
    g.fillStyle = '#3d5a43';
    g.fillRect(0, 0, Math.max(0, toMapX(CITY_LAYOUT.shoreX)), size);
    g.fillStyle = '#c9a35f';
    const sandX = toMapX(CITY_LAYOUT.sandFrom);
    g.fillRect(sandX, 0, Math.max(2, toMapX(CITY_LAYOUT.shoreX) - sandX), size);

    // Building footprints.
    g.fillStyle = 'rgba(235, 225, 205, 0.20)';
    for (const c of ctx.city.colliders) {
      const x0 = toMapX(c.minX);
      const x1 = toMapX(c.maxX);
      const y0 = toMapY(c.minZ);
      const y1 = toMapY(c.maxZ);
      if (x1 < 0 || y1 < 0 || x0 > size || y0 > size) continue;
      g.fillRect(x0, y0, Math.max(1.5, x1 - x0), Math.max(1.5, y1 - y0));
    }

    // Road grid.
    g.strokeStyle = '#79828f';
    g.lineCap = 'round';
    for (const roadX of CITY_LAYOUT.roadXs) {
      g.lineWidth = (roadX === CITY_LAYOUT.boulevardX ? CITY_LAYOUT.boulevardHalf * 2 : CITY_LAYOUT.roadHalf * 2) * scale;
      g.beginPath();
      g.moveTo(toMapX(roadX), 0);
      g.lineTo(toMapX(roadX), size);
      g.stroke();
    }
    g.lineWidth = CITY_LAYOUT.roadHalf * 2 * scale;
    for (const roadZ of CITY_LAYOUT.roadZs) {
      g.beginPath();
      g.moveTo(0, toMapY(roadZ));
      g.lineTo(size, toMapY(roadZ));
      g.stroke();
    }
    // The pier.
    g.strokeStyle = '#8a6a4a';
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(toMapX(148), toMapY(23));
    g.lineTo(toMapX(212), toMapY(23));
    g.stroke();

    // Mission route: a dashed gold line under everything that moves.
    const target = ctx.missionTarget;
    if (target) {
      g.strokeStyle = '#ffc93c';
      g.lineWidth = 3;
      g.setLineDash([7, 6]);
      g.beginPath();
      g.moveTo(centre, centre);
      g.lineTo(toMapX(target.x), toMapY(target.z));
      g.stroke();
      g.setLineDash([]);
      g.fillStyle = '#ffc93c';
      g.beginPath();
      g.arc(toMapX(target.x), toMapY(target.z), 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#14100a';
      g.beginPath();
      g.arc(toMapX(target.x), toMapY(target.z), 2.6, 0, Math.PI * 2);
      g.fill();
    }

    const dot = (x, z, radius, colour) => {
      g.fillStyle = colour;
      g.beginPath();
      g.arc(toMapX(x), toMapY(z), radius, 0, Math.PI * 2);
      g.fill();
    };
    // Traffic and parked cars.
    for (const vehicle of ctx.fleet.vehicles) {
      if (vehicle.kind === 'boat') { dot(vehicle.position.x, vehicle.position.z, 3, '#7fd4ff'); continue; }
      if (vehicle === ctx.playerVehicle) continue;
      dot(vehicle.position.x, vehicle.position.z, 2.6, vehicle.driver === 'traffic' ? '#dfe6ee' : 'rgba(200,205,215,0.45)');
    }
    // Syndicate guards.
    if (ctx.guards) {
      for (const guard of ctx.guards) {
        if (!guard.dead) dot(guard.group.position.x, guard.group.position.z, 3.4, '#ff4d5e');
      }
    }
    // Police blink red/blue with the light bars.
    const blink = Math.floor(this.elapsed * 5.5) % 2 === 0;
    for (const unit of ctx.police.units) {
      if (unit.wrecked) continue;
      dot(unit.vehicle.position.x, unit.vehicle.position.z, 4, blink ? '#ff2a30' : '#2a6bff');
    }
    if (ctx.police.heli && ctx.police.stars >= 4) {
      dot(ctx.police.heli.group.position.x, ctx.police.heli.group.position.z, 4.5, '#fff2cf');
    }

    // Val's arrow, rotated to her heading (or her car's).
    const heading = ctx.playerHeading;
    g.save();
    g.translate(centre, centre);
    g.rotate(radarAngle(heading));
    g.fillStyle = '#ffffff';
    g.strokeStyle = 'rgba(0,0,0,0.75)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(0, -8.5);
    g.lineTo(5.6, 6.5);
    g.lineTo(0, 3.4);
    g.lineTo(-5.6, 6.5);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
}

/**
 * Convert a world heading to a radar rotation. On the radar +x is right and
 * +z is down the canvas, and the arrow glyph points up at rotation 0, so:
 * facing +z (heading 0) -> PI, facing +x (heading PI/2) -> PI/2.
 */
function radarAngle(heading) {
  return Math.PI - heading;
}
