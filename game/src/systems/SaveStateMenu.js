// SaveStateMenu — the start/pause panel's memory. One localStorage slot holds
// Val's whole evening: position and heading, cash, health and armour, the
// selected weapon and the ammunition reserves, and the campaign's mission
// index. Saving and loading are wrapped in try/catch (private windows and
// file:// quirks must never crash the game), the slot status line in the
// menu always says what is stored, and New Campaign wipes the slot and
// restarts the story from the top.
const SAVE_KEY = 'solis-heat-save-v1';

export class SaveStateMenu {
  /** `game` is the SolisHeatGame shell, which owns every system we snapshot. */
  constructor(game) {
    this.game = game;
    this.statusEl = document.getElementById('menu-save-status');
    document.getElementById('menu-btn-save').addEventListener('click', () => this.saveGame());
    document.getElementById('menu-btn-load').addEventListener('click', () => this.loadGame());
    document.getElementById('menu-btn-new').addEventListener('click', () => this.newCampaign());
    this.refreshStatus();
  }

  readSlot() {
    try {
      const raw = window.localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  refreshStatus() {
    const save = this.readSlot();
    if (!save) {
      this.statusEl.textContent = 'Save slot: empty';
      return;
    }
    const mission = save.missionIndex >= 5 ? 'Free Roam' : `Mission ${save.missionIndex + 1} of 5`;
    this.statusEl.textContent = `Saved: ${mission} · $${Number(save.cash || 0).toLocaleString()} · ${save.when || ''}`;
  }

  saveGame() {
    const game = this.game;
    const player = game.player;
    const anchor = game.playerVehicle ? game.playerVehicle.position : player.position;
    const data = {
      v: 1,
      when: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      cash: player.cash,
      health: player.health,
      armor: player.armor,
      position: [anchor.x, anchor.z],
      heading: game.playerVehicle ? game.playerVehicle.heading : player.heading,
      weaponIndex: game.weapons.index,
      ammo: { ...game.weapons.ammo },
      missionIndex: game.missions.missionIndex,
    };
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      this.refreshStatus();
      game.hud.toast('Game saved');
      game.audio.blip('pickup');
    } catch {
      this.statusEl.textContent = 'Save slot: unavailable in this browser session';
    }
  }

  loadGame() {
    const save = this.readSlot();
    const game = this.game;
    if (!save) {
      game.hud.toast('No save in the slot yet');
      return;
    }
    if (game.playerVehicle) game.exitVehicle(true);
    const player = game.player;
    player.cash = Number(save.cash) || 0;
    player.health = Math.max(20, Number(save.health) || 100);
    player.armor = Number(save.armor) || 0;
    player.alive = true;
    player.group.rotation.x = 0;
    player.position.set(Number(save.position?.[0]) || 110, 0, Number(save.position?.[1]) || 150);
    player.position.y = game.city.groundHeightAt(player.position.x, player.position.z);
    player.heading = Number(save.heading) || 0;
    game.weapons.ammo = { smg: 320, shotgun: 48, ...(save.ammo || {}) };
    game.weapons.select(Number(save.weaponIndex) || 0);
    player.setWeaponProp(game.weapons.weapon.id);
    game.wanted.clearWanted();
    game.missions.restore(Number(save.missionIndex) || 0);
    this.refreshStatus();
    game.hud.toast('Save loaded');
    game.audio.blip('mission');
  }

  newCampaign() {
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      /* the slot may be unavailable; the reset below still applies */
    }
    this.game.resetCampaign();
    this.refreshStatus();
  }
}
