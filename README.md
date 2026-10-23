# Musica DJ 🎧

Reproductor de música para el celular que funciona como una **controladora Pioneer DJ** (estilo DDJ / CDJ): dos decks con jog wheels, mezclador con EQ de 3 bandas, crossfader, hot cues, loops y sync.

Es una aplicación web (PWA): no necesita instalar nada de una tienda. Se abre en el navegador del teléfono y se puede **añadir a la pantalla de inicio** para usarla a pantalla completa y sin conexión.

## Funciones

**Por cada deck (A y B)**
- **Jog wheel** táctil
  - Modo **VINYL**: tocar la superficie hace *scratch* (el audio sigue al dedo, incluso hacia atrás); el aro exterior hace *pitch bend*.
  - Modo **CDJ** (VINYL apagado): el jog solo empuja/frena el tempo (pitch bend); en pausa sirve para buscar.
  - **SHIFT + jog**: búsqueda rápida.
- **CUE** con comportamiento de CDJ: en pausa fija el punto de cue y, mientras lo mantienes, lo escuchas; al soltar vuelve al cue. Si pulsas PLAY mientras lo mantienes, sigue sonando. Tocando, CUE vuelve al punto y pausa. **SHIFT + CUE** vuelve al inicio.
- **PLAY/PAUSE** con LED parpadeante en pausa.
- **Tempo** fader (arriba = más lento, abajo = más rápido, como en Pioneer). Rangos ±6 / ±10 / ±16 % / WIDE (±50 %). Doble toque lo vuelve a 0.
- **SYNC**: iguala el BPM con el otro deck y alinea la fase de los beats. Si cambias el tempo del deck máster, el otro lo sigue.
- **Análisis automático** de BPM y beat grid al cargar la canción. **SHIFT + toque en el BPM** alterna doble/mitad si el análisis eligió la octava equivocada.
- **8 pads** con 4 modos:
  - **HOT CUE**: toca un pad vacío para guardar un punto, tócalo para saltar. En pausa suena mientras lo mantienes. **SHIFT + pad** lo borra.
  - **BEAT LOOP**: loops de 1/4 a 32 beats.
  - **ROLL**: loop momentáneo; al soltar, la canción sigue donde habría estado (como el modo *slip*).
  - **BEAT JUMP**: saltos de 1, 4, 8 y 16 beats hacia atrás/adelante.
- **Loops** manuales: IN / OUT, **4 BEAT/EXIT**, ½X y 2X. **SHIFT + 4 BEAT** = reloop.
- **QUANTIZE**: cues y loops caen exactamente sobre el beat.
- Forma de onda **de 3 bandas** (graves azul, medios naranja, agudos blanco) con beat grid, y vista general de la pista con **needle search** (toca la vista general para saltar). Toca la forma de onda grande para cambiar el zoom.
- Aviso visual cuando quedan menos de 30 s.

**Mezclador (estilo DJM)**
- TRIM, EQ HI / MID / LOW (girando al mínimo se corta la banda), **FILTER** (izquierda pasa-bajos, derecha pasa-altos, con resonancia).
- Faders de canal con vúmetros.
- **Crossfader** con curva suave o de corte rápido (para scratch).
- Volumen MASTER, limitador para que no sature el altavoz del teléfono.
- **REC**: graba tu mezcla y la descarga como archivo de audio.

Las perillas se giran arrastrando hacia arriba/abajo. **Doble toque** en una perilla la vuelve al centro. Todo es multitáctil: puedes mantener SHIFT con un dedo y tocar un pad con otro.

## Cómo usarla en el celular

La app necesita servirse por **HTTPS** (o `localhost`) para que funcione el motor de audio.

### Opción 1: GitHub Pages
1. En GitHub, ve a **Settings → Pages** del repositorio.
2. En *Source* elige *Deploy from a branch*, la rama donde está el código y la carpeta `/ (root)`.
3. Abre la URL que te da GitHub (`https://<usuario>.github.io/<repo>/`) en el teléfono.
4. Menú del navegador → **Añadir a pantalla de inicio**. Ábrela desde ahí y gira el teléfono en horizontal.

### Opción 2: en tu computadora
```bash
python3 -m http.server 8000
```
y abre `http://localhost:8000`.

### Cargar música
Pulsa **BIBLIOTECA → + AÑADIR MÚSICA** (o toca el título de un deck) y elige archivos de audio del teléfono: MP3, M4A/AAC, WAV, FLAC, OGG… Luego pulsa **A** o **B** para cargarlos en un deck.

> Las canciones de Spotify/Apple Music/YouTube Music están protegidas y no se pueden abrir: usa archivos propios.

### Consejos
- **iPhone**: si no suena, revisa que el interruptor de silencio no esté activado (en iOS 17+ la app pide sonido de reproducción y debería sonar igual). Safari no permite pantalla completa real: añádela a la pantalla de inicio.
- **Android**: el botón ⛶ pone pantalla completa y bloquea la orientación horizontal.
- La pantalla no se apaga mientras suena música.
- Un teléfono solo tiene una salida de audio, así que no hay pre-escucha por auriculares separada (CUE de cabina).

## Estructura

```
index.html              interfaz
css/style.css           estilos (look Pioneer, horizontal y vertical)
js/app.js               decks, mezclador, biblioteca, grabación
js/deck-processor.js    motor de audio (AudioWorklet): tempo, scratch, loops
js/analysis.js          BPM, beat grid y forma de onda de 3 bandas
js/ui.js                perillas, faders y botones táctiles
sw.js, manifest.webmanifest, icons/   PWA (instalable y sin conexión)
```

Sin dependencias ni compilación: solo HTML, CSS y JavaScript con Web Audio API.
