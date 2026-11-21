# Concrete Fury VR

An original WebXR physics combat sandbox for Meta Quest (and desktop). Runs in the
Quest Browser: no install, no build step, no downloaded assets. All textures,
models and sounds are generated procedurally at startup.

## Run it

```
node server.js
```

Open http://localhost:8080 on your PC to play with mouse and keyboard.

### On a Meta Quest

WebXR only works on `https://` pages or on `localhost`. Options:

1. **USB (quickest for testing):** enable developer mode on the Quest, connect it by
   USB, run `adb reverse tcp:8080 tcp:8080`, then open `http://localhost:8080` in
   the Quest Browser and press **Enter VR**.
2. **Any static HTTPS host:** upload this folder as-is (GitHub Pages, Netlify,
   Cloudflare Pages, etc.) and open the URL in the Quest Browser.

Shortcut for testing: `?play=survival&map=warehouse` jumps straight into a desktop game.
Modes: `sandbox`, `survival`, `waves`, `training`. Maps: `training`, `industrial`,
`abandoned`, `arena`, `warehouse`.

## Controls

**Quest:** left stick moves (click to sprint) · right stick turns (snap or smooth), up = jump,
down = crouch · grip grabs, climbs, drags bodies, opens doors; point at an item and grip to pull
it to your hand · trigger fires · with a gun in hand, A/X drops the magazine or opens the
revolver cylinder and B/Y racks the slide or closes the cylinder · grip at your belt with the
other hand to take ammo, then push it into the magwell, loading port or cylinder · grab the
slide or pump and pull back to chamber · let go of a weapon near your hip or over your shoulder
to holster it · Y with an empty left hand (or hold Y) opens the menu · X opens the sandbox
spawn menu.

**Desktop:** WASD, Shift, Space (also mantles ledges), C crouch, mouse look, LMB fire / swing /
punch, RMB aim down sights or throw, E grab/drop, R reload, Q swap holstered weapon,
G throw gun, F kick, Tab spawn menu, Esc pause.

## What's in it

- **Physics:** custom Verlet particle/constraint engine (`js/physics/verlet.js`) shared by
  ragdolls, props, doors, thrown items and severed limbs. Spatial hashing, box (OBB)
  contacts, sleeping bodies, time-corrected integration for 72/90/120 Hz.
- **Enemies** (`js/game/enemies.js`): active ragdolls. A procedural animation drives a
  physical skeleton, so every hit pushes them off pose. Hit location matters (head snaps,
  leg hits buckle the knee, arm hits disarm). They stagger, fall, and blend back up.
  Six types: Brawler, Stalker (dodges, lunges), Brute (charges, ground slam), Gunner and
  Rifleman (take cover, peek, burst fire, hold fire if an ally is in the way), and the
  training dummy. A* pathfinding on a nav grid.
- **Damage and gore:** per-enemy damage atlas with painted bullet holes, cuts, bruises and
  burns; torn clothing shows skin underneath; blunt dents and broken limbs; limb and head
  separation into independent physics pieces with stumps and pulsing blood jets; pooled blood
  particles, mist, decals on floors and walls that fade in the shader, puddles under corpses,
  bloody blades. Every effect obeys the Gore settings menu (intensity, blood, decals,
  ragdolls, dismemberment, performance mode).
- **Weapons:** pistol, revolver, pump shotgun, rifle (auto, penetrates), knife, machete, bat,
  sledgehammer. Guns reload physically; melee damage comes from swing speed and weapon mass;
  you can parry enemy attacks with a held weapon.
- **Environment:** breakable crates, chairs, tables and bottles; explosive barrels (they chain);
  glass panes; hinged doors; pop-up steel targets; ammo boxes and medkits.
- **Maps:** Training Facility, Industrial Facility, Abandoned Building, Underground Arena,
  Warehouse.
- **Modes:** Sandbox (spawn menu, AI aggressive/passive/frozen, god mode), Survival,
  Wave Arena, Training.

## Performance notes

Static level geometry is merged per material (about 10–20 draw calls per map). Each enemy is a
single skinned draw call. Decals are one instanced draw. Particles are fixed-size pooled buffers.
Enemy count, corpses, debris, decals and particles are capped (lower in Performance mode, which also
turns off shadows, lowers render resolution and halves the dynamic lights). Desktop measurements:
about 1.4 ms of simulation per frame with 11 enemies and 40 physics objects.

## Code map

```
js/main.js            renderer, WebXR session, main loop
js/core/              settings, procedural audio, procedural textures/materials
js/physics/verlet.js  physics engine
js/game/              player & hands, input, items, weapons, props, enemies, modes
js/world/             level builder + nav grid, the five maps
js/fx/effects.js      pooled particles, decals, tracers, casings, smoke, explosions
js/ui/                in-world menus (laser/mouse), HUD and wrist display
```
