# Prototype balance baselines

These notes record the rules the grid battle uses now, followed by design targets it does not implement yet. Formations, terrain, and player command remain the primary source of advantage.

## Specialist design targets (not built)

No battle rule implements these yet. They record what each Roman specialist is meant to feel like.

- **Armoured Equites:** a Wedge causes about five immediate frontal casualties only against a vulnerable, loose, or mob target. Prepared close-order heavy infantry still denies frontal impact. Wedge improves impact but reduces sustained melee output by 10%.
- **Plumbatarii:** a full-strength volley causes about four casualties against heavy cavalry. Only two volleys are carried; a damaging hit breaks a committed charge and creates a three-second counterattack window.
- **Ballistarii:** a deployed salvo causes about five casualties against ordinary heavy infantry and about three against a prepared frontal Tortoise. Eight slow salvos and a minimum range prevent it replacing bows or frontline infantry.
- **Lanciarii:** `+65%` melee damage against the `cavalry` tag makes the bonus survive integer casualty rounding in a frontal fight. Their `0.55` charge-resistance multiplier also halves incoming cavalry impact, but their ordinary anti-infantry output remains close to a Field Century.
- **Milites Christi:** guarding a Battery costs a full combat formation. In return, artillery inside 190 units takes 38% fewer melee casualties, 28% fewer ranged casualties, and 35% less morale loss. Guard effects do not stack.

## Tuning rule

Change unit values through the scenario builders, `BALANCE` or weapon profiles, and update the relevant grid-battle tests when the intended matchup changes. Avoid per-soldier exceptions or random combat rolls: they make formation decisions harder to read and reproduce.

## Grid-battle unit model

The grid prototype uses one compact profile per formation: model size, Attack, Armour, Defence, HP per model, unit type, Movement, and equipment. Model count is the sum of the formation's block occupants. Blocks do not duplicate the profile; they only record their current models, partial wounds, position, wavering, and combat state.

- `model capacity = floor(formation model space / model size)`: open formations provide 10 space and closed formations provide 18.
- Pressure and Resistance are derived from unit type plus formation mode. They are never stored as editable unit stats.
- Light/medium/heavy infantry currently contribute `2/3/4` Pressure and Resistance. Light/heavy cavalry contribute `3/4` Pressure and `2/3` Resistance.
- Closed formation adds `+2` Pressure and `+2` Resistance; open formation adds neither.
- HP per model is set so any full block has about 9-10 HP, so one blow costs each block a similar share of its strength.
- Attack creates damage. Defence is a deterministic percentage chance to evade that damage. Armour is a flat reduction after a hit; each surviving partial wound remains on its block according to HP per model.
- `shield_front` grants `+1` Armour only against the front face. Brace grants another `+1` Armour until the formation moves.
- `brace_against_charge` is equipment, not a permanent spear stat. It adds charge Resistance and counter-damage only while the equipped close-order infantry is actually braced and presents its front.

The unit catalogue now holds only what the grid battle and its cards read: type, class, strength, spacing, armour class, starting morale, shield, ranged weapon, and a one-line identity. Battle stats are derived from those in the scenario builders.

Not built, and removed from the catalogue until each has a battle rule (the values remain in git history at `0095d02`, `src/units/UnitArchetypes.ts` and `src/units/RangedWeapons.ts`):

- Per-unit melee values, charge impact and resistance, pursuit, and tagged damage bonuses such as Lanciarii against cavalry.
- Real-time handling: speed values, turn speed, acceleration, stamina, and per-terrain movement and disruption.
- Morale multipliers and individual rout thresholds.
- Guard auras, unique abilities such as Tortoise, switchable formation modes, and unit tags.
- Equipment drawing data and typical equipment lists.
- Weapon preferred range, volley timing, firing speed, morale shock, resupply, charge disruption, melee fallback, and required formations.

## Grid terrain prototype

- Visually varied open ground is consolidated into three rules: Clear costs one movement with unrestricted charges; Rough costs two, limits charges, and applies `-1` Resistance; Dangerous has the Rough rules and adds one incoming melee casualty. Grass, pasture, dry grass, and upland grass are Clear textures; rough ground, heather moor, ploughed field, scree, and shingle are Rough textures; swamp, peat bog, saltmarsh, and mudflat are Dangerous textures. Texture selection is cosmetic and cannot change the category's rules.
- Every battlefield square exposes a shared nine-point slot mask. Soldiers, characters, and stackable terrain objects use the same points for both capacity and rendering.
- Every art object occupies one to four points. Small trees and rocks currently use one; large trees, large rocks, and ponds use four. Any mix can stack up to nine total points, and two four-space objects plus one one-space object completely block the square. Close-order blocks spill soldiers who no longer fit into a new adjacent block belonging to the same formation. Five-soldier loose blocks and three-soldier cavalry blocks can rearrange around the remaining points without splitting.
- Terrain objects currently only consume space: trees, rocks, and ponds do not limit charges, block line of sight, or apply water hazards. Forest is a separate ground type with a distinct floor treatment that limits infantry charge distance and forbids cavalry charge paths; objects can be stacked on forest or any other non-building ground.
- Opposing blocks in a contested square share one nine-point mask. Active duellists reserve separate points opposite one another first; the remaining visible model points alternate between the two factions. This changes visual occupancy, not model count or melee calculations.
- Shallow river cells cost two movement and add one casualty to incoming melee damage. Deep river cells block voluntary movement; blocks forced into them by a retreat are destroyed.
- Roads cost half a movement point per square. A multi-block formation pays the highest destination cost among its blocks, so the whole formation benefits only while all of it remains on the road.
- Buildings occupy solid rectangular footprints of at least four squares. Every covered square consumes all nine spaces and blocks movement, forced entry, and line of sight; enterable rooms and doors are deliberately omitted.
- Fortress-wall tiles are walkable structure surfaces two levels above their underlying ground. Formations can move and fight along a continuous wall top, reach it from an effective height-one approach, and shoot over it from wall height. The sides are cliffs: voluntary crossing is blocked and forced movement off them is lethal. Wall tops limit charges and cannot contain stackable terrain objects.
- Edge features are shared physical tile borders with two independent classifications. Open edges are roofless and enclosed edges are roofed; this distinction is currently visual. Short edges preserve line of sight but reduce ranged damage to `70%` when they are the target's final crossed border. Tall edges block ranged line of sight completely. Edge features remain movement-neutral until a specific gate, fence, or ditch rule is requested.
- Elevation borders are the battlefield's ridges. Troops may climb or descend one level without a ramp. Larger cliffs block voluntary movement and destroy blocks forced across them; authored ramps only control the rendered slope.
- One deterministic relocation planner handles rigid movement, Fall back, and narrow-passage reorder moves. The fifteen-block Great Warband can therefore enter the three-square shallow ford as three files and five ranks while deep water remains forbidden. One order planner previews all player commands without mutating live state. Footprint-changing movement and every combat order require confirmation: `!` destinations are fixed, while `?` destinations cover Charge, Battle, and Press outcomes that depend on combat resolution. Finish-facing pivots do not relocate blocks.
- A charge target anchors the formation's approach rather than monopolising its attack. After landing, every front block with an enemy directly ahead resolves once in deterministic lateral order. Infantry charge bonuses and braced-front cancellation are snapshotted per initial contact; cavalry blocks carry momentum and breakthrough independently down each contacting lane.
- Infantry and cavalry follow-through uses the same file-advance rule as Press: whenever the lead block occupies a vacated enemy square, every contiguous rear block shifts forward behind it. Charge commitment ignores wavering stops; Press and ordinary Battle dressing still stop at a wavering follower.
- Battle only shoves a surviving block at net pressure 4 or more; Press and other attacks shove at 2 or more. Below the threshold a positive net makes the block waver.
- Battle preserves the formation's pre-combat foremost rank rather than every block's exact square. A lagging forward-facing file may advance into a gap it creates up to that rank, with steady rear blocks following; only Press or Charge may pursue beyond it.
