# Rapier 3D — Version Reference

| Field | Value |
|-------|-------|
| **Library** | `@dimforge/rapier3d-compat` |
| **Version Pinned** | ^0.14 |
| **Release Date** | 2024 |
| **Project Pinned** | 2026-04-08 |
| **LLM Knowledge Cutoff** | May 2025 |

## Why `rapier3d-compat` (not `rapier3d`)

The `-compat` build ships the WASM **inlined as base64** so it works without a
bundler — critical for our jam stack (CDN importmap only, no Vite/Webpack).
The non-compat version requires bundler-side WASM loading.

## CDN Import (jam-compatible)

```html
<script type="importmap">
{
  "imports": {
    "three": "https://esm.sh/three@0.174.0",
    "@dimforge/rapier3d-compat": "https://esm.sh/@dimforge/rapier3d-compat@0.14.0"
  }
}
</script>
```

```js
import RAPIER from '@dimforge/rapier3d-compat';

// MUST await init() before using anything else
await RAPIER.init();

// Now safe to create world
const gravity = { x: 0.0, y: -9.81, z: 0.0 };
const world = new RAPIER.World(gravity);
```

## Core Concepts

| Concept | Description |
|---|---|
| **World** | The physics simulation. Step it once per frame. |
| **RigidBody** | A physics body. Types: `dynamic`, `fixed`, `kinematicPositionBased`, `kinematicVelocityBased` |
| **Collider** | The collision shape attached to a RigidBody. Multiple colliders per body OK. |
| **Joint** | Constraint between two bodies (revolute, prismatic, fixed, spherical) |

## Creating a Body + Collider

```js
// Dynamic box (player, enemy, projectile)
const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
  .setTranslation(0, 5, 0)
  .setLinearDamping(0.5);
const body = world.createRigidBody(bodyDesc);

const colliderDesc = RAPIER.ColliderDesc.cuboid(0.5, 0.5, 0.5)
  .setRestitution(0.2)
  .setFriction(0.7);
const collider = world.createCollider(colliderDesc, body);
```

```js
// Static dungeon wall
const wallBody = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
world.createCollider(RAPIER.ColliderDesc.cuboid(halfW, halfH, halfD), wallBody);
```

```js
// Kinematic platform (moves but not pushed by physics)
const platBody = world.createRigidBody(
  RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0)
);
// Move it via setNextKinematicTranslation(...) each frame
```

## Stepping the World

```js
const FIXED_TIMESTEP = 1 / 60;
let accumulator = 0;

function animate(deltaSeconds) {
  accumulator += deltaSeconds;
  while (accumulator >= FIXED_TIMESTEP) {
    world.step();
    accumulator -= FIXED_TIMESTEP;
  }
  syncMeshesToBodies();
  renderer.render(scene, camera);
}
```

**Why fixed timestep:** Rapier is deterministic only with a fixed step. Variable
step causes desync in multiplayer (we use Colyseus — server must match clients).

## Sync to Three.js Mesh

```js
function syncMeshesToBodies() {
  for (const { mesh, body } of entities) {
    const t = body.translation();
    const r = body.rotation();
    mesh.position.set(t.x, t.y, t.z);
    mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}
```

**Reuse temps where possible** — `body.translation()` allocates a new object each
call. For hot loops, use `body.translation()` directly into a temp.

## Raycasting (for buster shoot, lock-on)

```js
const ray = new RAPIER.Ray(
  { x: origin.x, y: origin.y, z: origin.z },
  { x: dir.x, y: dir.y, z: dir.z }
);
const maxToi = 100.0;
const solid = true;
const hit = world.castRay(ray, maxToi, solid);
if (hit) {
  const point = ray.pointAt(hit.toi);
  const collider = hit.collider; // collider that was hit
}
```

## Collision Events

```js
const eventQueue = new RAPIER.EventQueue(true);
world.step(eventQueue);
eventQueue.drainCollisionEvents((handle1, handle2, started) => {
  // handle1, handle2 are collider handles
  // started === true on contact begin, false on contact end
});
```

## Footguns

1. **Forgetting `await RAPIER.init()`** — every Rapier call will throw "wasm not initialized"
2. **Variable timestep** — non-deterministic; will desync multiplayer
3. **Trimesh colliders for dynamic bodies** — terrible performance, often broken; use convex hulls or compounds instead
4. **No `setLinearDamping`** — bodies slide forever in zero-friction conditions
5. **Iterating bodies during step** — undefined behavior; build a list first
6. **CCD off by default** — fast projectiles tunnel through walls; enable with `colliderDesc.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)` and `bodyDesc.setCcdEnabled(true)`
7. **Sleeping bodies** — bodies that haven't moved for ~0.5s sleep to save CPU; wake them with `body.wakeUp()` if you teleport them via `setTranslation()`
8. **Units = meters** — your player should be ~1.7 high, not 170. Don't use Three.js millimeter scales

## Sources (verify against these for any uncertain API)

- Official JS docs: https://rapier.rs/javascript3d/
- GitHub: https://github.com/dimforge/rapier.js
- Examples: https://rapier.rs/demos3d/index.html
- npm: https://www.npmjs.com/package/@dimforge/rapier3d-compat
