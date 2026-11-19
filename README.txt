ZOID MERCENARIES
Personal non-commercial browser proof of concept.
MechWarrior-style contracts, piloting mock Zoids built from basic shapes.

RUN
  cd into this directory and start a static server:

    python3 -m http.server 8080

  Open http://localhost:8080
  No build step. three.js r170 is vendored at vendor/three.module.js and
  loaded with an import map. The page is plain ES modules.

  Tests (Node 20, and Chrome for the browser pass):

    npm install
    npm test

  That runs tests/damage.test.mjs, tests/aim.test.mjs, tests/input.test.mjs,
  tests/reset.test.mjs, tests/models_check.mjs, tests/heat.test.mjs,
  tests/skills.test.mjs, tests/indicators.test.mjs, tests/weapons.test.mjs,
  tests/glb.test.mjs, tests/headless.mjs, tests/glb_browser.mjs, and the
  rest listed in package.json, including tests/weapons_overhaul.test.mjs,
  tests/battlefields.test.mjs, tests/pass_radar.test.mjs,
  tests/weapons_overhaul_browser.mjs, tests/battlefields_browser.mjs,
  tests/pass_radar_browser.mjs (mountain pass routes and radar),
  tests/targeting.test.mjs and, last, tests/targeting_browser.mjs
  (hit volumes, weapon selection, scope, melee).
  The browser test serves this directory on port 8080, so stop any other
  server on that port first. Screenshots land in screenshots/.

CONTROLS
  Hangar: click a Zoid, buy and equip gear, then Launch a contract.
  In the field, click the view to capture the mouse.

    W / S or arrow up / down   throttle
    A / D                      strafe
    Mouse                      look (pointer lock)
    Arrow left / right         look without the mouse
    Mouse wheel                switch weapon: down = next, up = previous (wraps)
    1-9                        select that weapon slot directly
    Left mouse                 fire the selected weapon only
    Right mouse                Sniper Rifle selected: hold to zoom 4x, click
                               again while held for 8x; any other weapon: fire
                               (the browser menu is cancelled)
    Q                          active skill

  One weapon is selected at a time and only it fires, from its own mount
  (muzzle) toward the world point under the crosshair. Slots run head,
  left, right, back, then the standard melee every Zoid carries. A switch
  takes 0.18 s; unselected weapons keep cooling and reloading. With a
  locked target near the crosshair, the aim snaps to the target's centre of
  mass (modest assist), so every mount converges on the target. If the
  center ray hits nothing, the mount aims 1000 m out along it. The player's
  own Zoid is ignored by that ray. Ballistic guns are zeroed at their ideal
  range: inside it the shell meets the crosshair, past it the shell lands
  low (see WEAPONS). The crosshair circle shows the selected weapon's
  spread (bloom) and the range; pips round it, one per slot, mark the
  selection, and an AIM / BLOCKED mark shows where the selected mount's own
  line goes. With the melee selected the reticle reads IN REACH or OUT OF
  REACH. The weapon dock has one row per slot (selected row highlighted):
  ready, switching, cooling, charging, overheated or disabled, plus max
  range. Full targeting notes: docs/TARGETING_NOTES.txt.
  Each weapon has its own heat gauge, heat per shot, and cooling rate.
  A weapon that reaches 100 heat locks until it cools below 55. The other
  weapons keep firing. The PEAK bar is the hottest weapon, not a shared pool.
    Shift                      boost, if back boosters are fitted and the back mount stands
    V                          first person / third person
    Tab                        cycle targets in sensor range, nearest first
    R                          lock the enemy under the crosshair (12 degree box), else nearest
    H                          control list, weapon rules, and every Zoid skill
    Esc                        pause and release the mouse

  WASD follows the chassis. The torso and the camera follow the mouse, and
  the legs catch up at the Zoid's turn rate. There is no overall health bar.

WEAPONS
  Full rules and the stat table: docs/WEAPONS_NOTES.txt. Short version:

  Targeting. Sensor lock range is 190 m (more with sensor skills). R locks
  the enemy inside a 12 degree box round the crosshair, else the nearest;
  Tab cycles. A target outside sensor range keeps the lock for 3 s, then it
  drops. Turrets turn on their own toward the locked target but fire only
  when selected with the trigger held. Corner brackets mark the locked
  enemy. Hits use per-Zoid hit volumes built from the model's parts, and
  the lock box, lead box, missiles and AI all aim at the centre of mass, so
  small Zoids such as the Gun Sniper can be hit
  (docs/TARGETING_NOTES.txt).

  Standard melee. Every Zoid has a free melee strike (Strike Claw, Fang
  Lunge, Tail Smash, Strike Kick and so on) in its last slot: reach about
  9-17 m from the front of the Zoid, no ammo, low heat, damage by weight,
  lunge, knockback and stagger. Cover blocks it.

  Sniper scope. Hold the right mouse button with the Sniper Rifle selected:
  4x zoom from the cockpit, a second click for 8x, slower look, range and
  drop in the scope. Release or switch weapon to leave it.

  Fire modes. Gatling: automatic, spins up over 0.6 s. Pulse Laser: bursts
  of 3. Beam Cannon: a sustained 0.45 s beam you hold on the target.
  Missile Pack: salvo of 4 (pop-up and dive scale with range, a proximity
  fuse near the target). Shock Cannon and Sniper Rifle: single heavy
  shots. Charged Particle Cannon: 3 s stationary charge, unchanged.

  Spread. Every shot scatters inside a cone that grows with sustained fire
  (bloom), movement, heat above 60%, and range past ideal for guns.

  Ballistic. Gatling, Shock Cannon, Sniper Rifle. Real shells with travel
  time and gravity. Guns are zeroed at their ideal range; past it shells
  land low (Shock Cannon about 4.3 m low at 100 m), so aim high or use the
  LEAD box. The HUD shows the real IMPACT point, DROP or ZERO, and LEAD for
  the locked target. Damage falls to 85% at the long mark and 70% at max.

  Beam. Pulse Laser, Beam Cannon, Double Beam Cannon, Charged Particle
  Cannon. Instant, no drop, but damage falls fast past ideal (30% at the
  long mark, 10% at max). Smoke, dust and mist clouds on every map, and
  smoke from wrecks, refract beams: they bend, scatter visibly and lose
  power (about 38% lost through 20 m of dust for a Pulse Laser; the
  Charged Particle Cannon only loses about 15%). Shells and missiles ignore
  clouds.

  Rocket. Missile Pack. Will not launch until a lock finishes: 2.2 s on a
  still target under the crosshair or within the 8 degree seeker cone.
  Speed weakens the lock and 30 m/s breaks it. A cloud on the line of
  sight blocks the lock (SEEKER BLOCKED), and a target inside a cloud
  blinds missiles in flight. Warheads arm after 25 m (25% damage closer).

  Charge. Charged Particle Cannon. Hold the fire button for 3 seconds
  while stationary (planar speed under 0.75 m/s). The charge bar fills.
  Releasing early or moving clears it and does not fire. At 3.0 s, still
  held and still stopped, it fires a full-power hitscan bolt by itself.
  Partial charge never fires. Geno Saurer's Particle Cannon skill is a
  separate instant bolt on Q. Q is a tap, not a hold, so that skill does
  not use this 3 second rule.

  AI pilots use the same spread, drop, falloff, refraction and lock rules.
  Higher difficulty pilots compensate for shell drop better.

  Range. If the locked target is past a weapon's max, that dock row reads
  OUT OF RANGE. If it is past every fitted weapon, the crosshair turns red
  and the target line says OUT OF RANGE. Sensor range is a different line:
  OUT OF SENSOR RANGE.

  Pulse Laser              beam       ideal 55 m   max 90 m    bursts of 3
  Beam Cannon              beam       ideal 95 m   max 160 m   0.45 s beam
  Gatling Gun              ballistic  ideal 35 m   max 100 m   170 m/s, zero 35 m
  Shock Cannon             ballistic  ideal 45 m   max 105 m   80 m/s, zero 45 m
  Sniper Rifle             ballistic  ideal 140 m  max 230 m   220 m/s, zero 140 m
  Missile Pack             rocket     ideal 90 m   max 200 m   lock 2.2 s, salvo 4, arms 25 m
  Charged Particle Cannon  charge     ideal 130 m  max 240 m   hold 3 s, then hitscan

FEATURES
  Thirteen playable Zoids: Shield Liger, Blade Liger, Command Wolf, Gojulas,
  Zaber Fang, Iron Kong, Geno Saurer, Death Saurer, Gun Sniper, Elephander,
  Berserk Fuhrer, Molga, Pteras. Each has its own speed,
  turn rate, armor scale, hardpoints, weight, and price.
  Hangar loadout: weapons, per-part armor plating, speed gyros, maneuver
  gyros, and back boosters. Weight and hardpoint size are enforced.
  Money is in C-bills and is stored in localStorage under zoidMercs.save.v1,
  with the owned Zoids and their loadouts. Reset company asks for
  confirmation, then deletes that save and any other zoidMercs.* key and
  rebuilds the starting hangar.
  Damage is per part (head, core, legs, tail, weapon mounts, back mount).
  Armor is lost first, then structure. A destroyed leg slows speed and turn.
  A damaged head scrambles the HUD and shortens sensor range. A destroyed
  mount disables the weapons on it. Boosters die with the back mount.
  Core destruction destroys the Zoid.
  Survey beacons, escort exits, and assault generators plant a tall light
  pillar with fog disabled, plus a bright marker and distance label that
  draw through the world. If the objective is off screen, behind the camera,
  or past radar range, an arrow with the distance sits on the screen edge.
  The minimap keeps that contact clamped to its own edge.
  The HUD paper doll shows the player and the locked target, color coded.
  Four battlefields (see BATTLEFIELDS below): Abandoned City, Dense Jungle,
  Sparse Jungle, Rocky Mountain Pass. Hard cover stops shots and line of
  sight, water slows Zoids and cools weapons, small props break.
  Contracts: destroy a lance, escort supply trucks, scan three beacons, or
  assault a generator. Win for a payout and a small salvage bonus, then pay
  repair costs or take a field loan if the core is gone. Enemy Zoids move,
  flank, aim, and shoot. Enemy pilots may use their Zoid skill when a target
  is close. A missing skill does nothing.

BATTLEFIELDS
  Every map is 1224 m square inside a terrain rim (canyon walls in the
  pass). Buildings, trees, rocks and terrain are hard cover: shells and
  beams stop on them, missile locks need a clear line of sight (SEEKER
  BLOCKED: COVER or TERRAIN), and enemy pilots hold fire without sight.
  Abandoned City: ruined blocks on a 70 m grid with 26 m streets, a 68 m
  central avenue (28 m paved) for the convoy, towers up to 58 m, collapsed
  blocks and fallen slabs, burning wrecks, smoke and dust clouds, and a
  flooded canal. Wrecked cars and barriers break (and superheavies walk
  through them).
  Dense Jungle: about 280 big trees, 180 saplings, thick undergrowth,
  heavy fog and seven mist banks, a river and a pool. Short sightlines.
  Sparse Jungle: tree clusters around open clearings, lone giants, ponds
  and streams, light haze. Long sightlines.
  Rocky Mountain Pass: a winding canyon 110-265 m wide with cliffs up to
  about 95 m that ground Zoids cannot climb, two 110 m chokepoints, low ridges,
  rock spires, boulders, meltwater pools and dust. Four side routes split off
  and rejoin it out of sight of the main canyon: the West Gully (20 m floor),
  the East Ledge switchback (about 7 m, too narrow for Gojulas and Death
  Saurer), the High Ridge Trail (14 m, 24 m above the floor) and the South
  Bypass (16 m). Every spawn and objective stays reachable for every Zoid.
  Radar: mountains, cliffs, rock spires and buildings 40 m or taller hide
  enemies from the minimap and target lock unless they are within 45 m. A
  contact that drops out of sight stays on radar 2.5 s, then leaves a fading
  red diamond with a ? at its last known position (gone after 12 s). Standing
  still (x0.8) or running cool (x0.9) shrinks the range you are spotted at.
  Enemy pilots use the same rule: lose them behind a ridge and they go to
  where they last saw you, search there for 10 s, then move on.
  Water: wading slows a ground Zoid up to 40% (big Zoids less), weapons
  cool 50% faster while wading (HUD: WADING), and beams through water
  lose power fast. Mist scatters beams like dust.
  Destructible: cars, barriers, saplings and small boulders (shoot them, or
  walk through them with a Zoid at least as wide as the prop).
  Enemy pilots plan routes around blocks, cliffs and deep water, step
  around cover, duck behind hard cover to cool hot weapons, and break away
  when stuck. Pteras flies over all cover (tallest cover 58 m, ceiling
  70 m above the ground). All set dressing is procedural (no new assets).
  MSAA is switched off on software GL and high-DPI phones (?aa=1 forces it
  on, ?aa=0 off). See docs/BATTLEFIELDS_NOTES.txt.

SKILLS
  Q is the active skill. The HUD names it and shows cooldown or heat.
  The hangar lists the passive and the active on the Zoid you are viewing.
  The Shield Liger shield is a toggle. Weapons cannot fire while it is up.

  Command Wolf
    Passive  Pack Sensors. Radar and target lock reach 35% farther, and HUD
             scramble is cut by a third.
    Active   Sensor Lock. For 6 seconds radar and lock reach twice as far again.
    Cost     cooldown 14s
  Zaber Fang
    Passive  Predator Stride. Top speed is 12% higher.
    Active   Speed Burst. For 4 seconds speed is multiplied by 1.55.
    Cost     cooldown 9s
  Shield Liger
    Passive  Shield Plate. While the left foreleg stands, front-arc hits deal
             70% damage.
    Active   Energy Shield. Toggle. Blocks 100% of front-arc damage. Weapons
             cannot fire while it is up. Heat rises at 36 per second.
    Cost     lockout until the gauge cools below 55, plus 2.5s
  Blade Liger
    Passive  Blade Tempo. Above 8 m/s, incoming damage is reduced by 12%.
    Active   Laser Blade. Dash 18 m forward and slash 32 damage in a front cone.
    Cost     cooldown 7s
  Iron Kong
    Passive  Plate Armor. Incoming damage is reduced by 10%.
    Active   Ground Pound. 24 damage within 12 m, then 20% less damage taken
             for 4 seconds.
    Cost     cooldown 11s
  Geno Saurer
    Passive  Particle Vent. Energy weapons cool 30% faster.
    Active   Particle Cannon. An instant bolt for 70 damage out to 160 m.
             Q is a tap, so this is not the mounted cannon's 3 second charge.
    Cost     70 skill heat, locked until heat falls below 40, cooldown 4s
  Gojulas
    Passive  Siege Brace. Below 6 m/s, incoming damage is cut by 15% and
             weapon spread tightens.
    Active   Artillery Barrage. Five shells at the aim point, 16 damage each.
    Cost     cooldown 12s
  Death Saurer
    Passive  Super Heavy Frame. Incoming damage is reduced by 18%.
    Active   Overload. For 6 seconds weapons hit 40% harder, build 50% more
             heat, and incoming damage drops a further 15%.
    Cost     cooldown 10s
  Gun Sniper      Sniper Optics (+25% radar) / Steady Aim (+30% damage 5 s, cd 12s)
  Elephander      Elephant Hide (-14% damage taken) / Stampede (30 dmg in 14 m, cd 12s)
  Berserk Fuhrer  Berserk Drive (+8% speed) / Buster Claw Charge (16 m dash, 36 dmg, cd 8s)
  Molga           Segmented Armor (brace below 6 m/s) / Ram (14 m charge, 26 dmg, cd 9s)
  Pteras          Sky Eye (+30% radar) / Bombing Run (4 bombs x 14 dmg, cd 11s)

MODELS
  Command Wolf, Shield Liger, Blade Liger, Iron Kong, Geno Saurer, Death
  Saurer, and Death Stinger load
  Sketchfab meshes from assets/models (see CREDITS.txt). They face local -Z,
  stand on y = 0, and are split into the same named damage parts as the mocks.
  Shield Liger prefers assets/models/shield-liger-anim.glb, a rigid skin with
  Idle, Walk, Run, ShieldActivate, ShieldMaintain, and Fire. If that file
  fails it uses the static shield-liger.glb, then the procedural mock. The
  other files are static. Zaber Fang and Gojulas stay
  boxes, cylinders, and cones. Add ?mock=1 to the page address to force the
  procedural model for every Zoid. If a GLB fails to load, that Zoid falls
  back to its mock. The hangar footer opens the credit list.
  Lions, the wolf, and the saber-tooth are quadrupeds. Iron Kong is a gorilla.
  Geno Saurer, Gojulas, and Death Saurer are bipedal theropods. Mock-only
  machines keep their colored silhouettes: red saber fangs, olive siege
  walker, purple super heavy. Procedural legs swing while moving. The Shield
  Liger plays its skeletal clips instead: idle, a diagonal walk, a bounding
  run, the energy-shield deploy, and a firing recoil. The hangar preview
  loops the walk. Q still toggles the energy shield, and weapons do not fire
  while it is up. Rebuild the animated file from the repo root:
    /workspace/tools/blender-4.5.14-linux-x64/blender -b --python tools/rig_shield_liger.py

MODEL CREDITS
  License for all seven meshes: CC-BY-4.0
  http://creativecommons.org/licenses/by/4.0/
  Changes: scaled/split/optimized/stripped helper nodes

  Zoids Blade Liger
    guntuy3 — https://sketchfab.com/guntuy3
    https://sketchfab.com/3d-models/zoids-blade-liger-d4caf50b3c934b2ba29fd2f25d730f28
  Shield Liger WIP
    hdbanks1 — https://sketchfab.com/hdbanks1
    https://sketchfab.com/3d-models/shield-liger-wip-c903bfa399194201a0cb649311ec308f
    Changes: scaled/split/optimized/stripped helper nodes; rigged with armature, split into segments, animated
    Rebuild: /workspace/tools/blender-4.5.14-linux-x64/blender -b --python tools/rig_shield_liger.py
  Genosaurer Zoids (free)
    Anderson455 — https://sketchfab.com/pablo.gabriel87
    https://sketchfab.com/3d-models/genosaurer-zoids-free-3b7075f3b14a4022ad3996e0eda8ca88
    (game file since 25 Oct 2026: Daniel Williams' recoloured re-export of
    this same mesh, genosaurer_new.glb; no metadata in that file)
  Command Wolf
    Warner's Digital Art — https://sketchfab.com/warnerdraws
    https://sketchfab.com/3d-models/command-wolf-a69dcd74f065467981aaf3d9dc913b59
  Iron Kong - Zoids
    Anderson123 — https://sketchfab.com/Mr_Anderson123
    https://sketchfab.com/3d-models/iron-kong-zoids-74a45b6ead5f4f21bc6df68c9ca9bd9a
    (game file since 25 Oct 2026: Daniel Williams' recoloured re-export of
    this same mesh, iron_kong_new.glb; no metadata in that file)
  Death saurer Zoids (free)
    Anderson455 (now Anderson123) — https://sketchfab.com/pablo.gabriel87
    https://sketchfab.com/3d-models/death-saurer-zoids-free-57539bc35b2445e997c091cccbdbee8b
  Death Stinger Zoids (free)
    Anderson455 (now Anderson123) — https://sketchfab.com/pablo.gabriel87
    https://sketchfab.com/3d-models/death-stinger-zoids-free-26c18f813ea741b691b8d5e421b3ded5

KNOWN GAPS
  Five Zoids use CC-BY Sketchfab meshes that were scaled, split, and
  compressed for the browser. They are not the official product models.
  The Shield Liger rig is a rigid split by region, not a hand-weighted
  skeleton. Small shards can sit off a limb, and the mane plates are the
  regions that could be separated cleanly.
  Gojulas uses gojulas.glb, supplied by Daniel Williams on 25 Oct 2026,
  licence not stated (no author or licence in the file); its old mock is
  the ?mock=1 fallback. No Zoid is a procedural-only mockup any more. Death Saurer and
  Death Stinger (added 25 Oct 2026) use Sketchfab meshes; see
  docs/NEW_ZOIDS_NOTES.txt.
  Gun Sniper uses a GLB supplied by Daniel Williams on 25 Oct 2026 (no
  author or licence in the file; assumed to be his own). Its old procedural
  model is kept as the ?mock=1 fallback. It was replaced the same day by
  Daniel's second file (gun_sniper.glb, same mesh with panel textures,
  also no author or licence; textures flattened to their mean colours).
  Zaber Fang uses zaber_fang.glb, supplied by Daniel Williams on 25 Oct
  2026, licence not stated (no author or licence in the file). Its old
  procedural mock is the ?mock=1 fallback.
  Elephander, Berserk Fuhrer, Molga, and Pteras are original
  procedural models made for this project (no free CC-BY/CC0 model of them
  was found). Pteras flies at a low fixed height (flyHeight in js/catalog.js).
  See docs/NEW_ZOIDS_NOTES.txt.
  No multiplayer. Melee is the Blade Liger's laser-blade dash only.
  Weapons have no ammo count. Heat is per weapon, and there is no magazine.
  Beams hit instantly but refract in clouds. Shells drop past zero range.
  Missiles need a 2.2 s lock and cannot launch without one. The charged particle cannon fires
  only after a 3 s stationary hold. Enemy pilots carrying that cannon stop
  to brace while the target is in range.
  Salvage is a C-bill bonus, not a recovered weapon.
  Enemy pilots are simple: close, circle, face the target, fire in range.
  Mission variety is four contract types on four battlefields.
  Sound is short synthesized beeps. There is no music.
  Keyboard and mouse only. No joystick.
  Cover collision is circles and axis-aligned boxes (fallen slabs and
  tilted ruins collide as boxes). Buildings cannot be destroyed. The
  first-person view is a camera at the head, not a cockpit interior.
  Friendly fire is possible. The convoy trucks do not fight.

Speed: canon-relative top speeds, 3 Speed Booster levels (full set = canon top speed), per-Zoid acceleration, KM/H / MPH toggle. See docs/SPEED_NOTES.txt.
Install: hangar "Add to Home Screen" button; see docs/HOME_SCREEN_NOTES.txt.
Weapons: targeting box and lock rules, bloom reticle, fire modes, zeroing and drop, beam refraction in clouds, missile arming. See docs/WEAPONS_NOTES.txt.
Battlefields: abandoned city, dense and sparse jungle, rocky mountain pass; cover, LOS, water, destructible props, AI routing. See docs/BATTLEFIELDS_NOTES.txt.
