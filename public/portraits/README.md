# Character portraits

Drop PNG character portraits into this folder. The game looks up portraits by
companion ID, so no import or code change is needed for existing characters.

Current filenames:

- `flavia.png` — Flavia Marcellus
- `cassian.png` — Cassian Corvus, using `Art/Characters/Roman/Aurelius Corvus.png`
- `decimus.png` — Decimus Aurelian, using `Art/Characters/Roman/Titus Vitalianus.png`
- `valeria.png` — Junia Valeria, using `Art/Characters/Roman/Cassia Severina.png`
- `brennos.png` — Brennos of Venta, using `Art/Characters/Roman/Brennos.png`
- `aelia.png` — Aelia Naso, using `Art/Characters/Roman/Aelia Marcella.png`

Use lowercase filenames exactly as shown. A portrait is reused in the formation
roster, war council, and after-battle cutscene. Transparent PNGs work best; use a
roughly 3:4 portrait with the face near the upper centre and enough body below it
for the cutscene crop. If a file is absent or cannot load, the existing coloured
initials portrait remains visible.

After adding or replacing a file, refresh the game.
