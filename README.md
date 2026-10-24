# Musica DJ 🎧

Reproductor de música para el celular que funciona como una **controladora Pioneer DJ** (estilo DDJ / CDJ): dos decks con jog wheels, mezclador con EQ de 3 bandas, crossfader, hot cues, loops y sync.

La estética toma el ADN de Pioneer (negro, blanco, LEDs, jog, pantallas LCD) y lo reinterpreta con lenguaje de app actual: tarjetas de vidrio esmerilado, esquinas suaves, luz ambiental que respira con la música, textura de grano y tipografía del sistema.

Es una aplicación web (PWA): no necesita instalar nada de una tienda. Se abre en el navegador del teléfono y se puede **añadir a la pantalla de inicio** para usarla a pantalla completa y sin conexión.

## Pantalla principal

- La **canción que suena**, con un disco que gira y su forma de onda (tócala para saltar).
- **Anterior / Play-Pausa / Siguiente.**
- **Tempo:** Original, Igualar o **BPM fijo**, con la perilla (deslizar arriba/abajo, 0,1 BPM) y los botones + / − (1 BPM). Tocar la perilla o + / − pasa directamente a BPM fijo partiendo del BPM de la canción que suena.
- Abajo, la barra **Lista de reproducción** muestra qué sigue y abre el panel de música.
- ⚙︎ **Ajustes:** duración de la transición, acceso al **Modo DJ** y espacio usado.

## Lista de reproducción y biblioteca

El panel tiene dos pestañas:

**Cola** — lo que suena y lo que viene. Tocar una canción mezcla hacia ella ya; con **⋯** puedes ponerla *a continuación*, quitarla o guardarla en una carpeta. *Vaciar* borra lo que venía después.

**Biblioteca** — tu música dentro de la app:
- **Importar canciones** abre los archivos del teléfono (MP3, M4A, WAV, FLAC…). En Android también puedes **importar una carpeta entera**, que se crea igual dentro de la app.
- **Tocar una canción = suena a continuación** (si no suena nada, empieza ya).
- **Carpetas / listas:** crea carpetas (y subcarpetas), y con **⋯ → Añadir a carpeta** mete cualquier canción en una o varias. Cada carpeta tiene *Reproducir*, *Aleatorio* y *A la cola*.
- **Buscador** por nombre de canción o carpeta (sin importar tildes ni mayúsculas).
- Cada canción muestra su BPM y duración; en BPM fijo, a cuánto se ajustará (`124.5 → 128.0`) o si queda fuera de rango.

Todo se **guarda en el teléfono** (canciones, carpetas, BPM analizados y la cola), así que sigue ahí al volver a abrir la app. El BPM se analiza en segundo plano al importar. Eliminar una canción de la app no borra el archivo original del teléfono.

## Mezcla automática entre canciones

Unos segundos antes de que termine una canción, la siguiente ya está cargada y analizada. Durante la mezcla el volumen pasa de una a otra con curva de potencia constante y **se intercambian los graves** a mitad de la transición, para que no choquen los dos bombos.

**Duración de la transición:** Corte, 6, 12, 20 o 30 s.

**Tempo** (tres modos):

| Modo | Qué hace |
|---|---|
| **Original** | Cada canción suena a su BPM real; solo se mezcla el volumen. |
| **Igualar y volver** | La siguiente entra al BPM de la anterior (si la diferencia es de hasta ±8 %), justo al inicio de un compás y con los beats alineados; después vuelve poco a poco (20 s) a su BPM real. |
| **BPM fijo** | Eliges el **BPM del set** (por ejemplo 128) y **todas** las canciones suenan a ese tempo, como si movieras el fader de tempo de la controladora. Lo subes o bajas cuando quieras con la **perilla** (deslizando el dedo hacia arriba o abajo, 0,1 BPM por paso) o con los botones **+ / −** (1 BPM; mantenidos, repiten): 128 → 129 → 130… y la canción que suena se desliza suavemente al nuevo tempo. Las mezclas entran a compás y en fase. |

En **BPM fijo** la lista muestra a cuánto se ajusta cada canción (`124.5 → 128.0`). Se permite hasta ±16 % (el rango típico de una controladora). Canciones a mitad o al doble de tempo también encajan (64 o 256 BPM → 128). Si una canción queda fuera de rango (por ejemplo, reggaetón a 95 con el set en 128), se marca en rojo y suena a su tempo original, con un crossfade normal.

> Igual que en una controladora sin *Master Tempo*, al cambiar el tempo también cambia un poco el tono.

⏭ empieza la mezcla hacia la siguiente en el próximo compás, y tocar una canción de la lista mezcla hacia ella.

Con **🎛 MODO DJ** pasas a la consola completa (también ves cómo la mezcla automática mueve el crossfader y los EQ). Si cargas una canción a mano en un deck, la mezcla automática se detiene.

## Modo DJ: funciones

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

## Instalar en Android (app nativa)

1. En el teléfono, abre la página de **Releases** del repositorio en GitHub y entra en **Musica DJ para Android** (etiqueta `android-latest`).
2. Descarga **`MusicaDJ.apk`** y ábrelo.
3. Si Android lo pide, permite **"Instalar apps de esta fuente"** para tu navegador o gestor de archivos.
4. Abre **Musica DJ** desde el cajón de aplicaciones. La primera vez que suene música pedirá permiso para mostrar notificaciones: acéptalo para tener los controles.

Como app nativa:
- **La música sigue sonando con la pantalla bloqueada** y en segundo plano (servicio de reproducción).
- Notificación con **anterior / pausa / siguiente**, también en la pantalla de bloqueo y con los botones de auriculares Bluetooth.
- Para cerrarla del todo, deslízala desde "recientes".

**Actualizaciones:** cada cambio en el código compila un APK nuevo automáticamente (GitHub Actions → *APK Android*). Descárgalo igual que la primera vez: se instala encima y conserva tu biblioteca, carpetas y cola.

> El APK se firma con una clave incluida en el repositorio (`android/app/musica-dj.keystore`) para que todas las versiones tengan la misma firma. Es suficiente para uso personal; si algún día se publica en Google Play, conviene generar una clave privada nueva.

### Compilar el APK a mano
Requiere Node 22, JDK 21 y el SDK de Android:
```bash
npm ci
npm run sync                 # copia la web a android/
cd android && ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk
```

## Usarla desde el navegador

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
Toca la barra **Lista de reproducción → Biblioteca → Importar canciones** y elige archivos de audio del teléfono: MP3, M4A/AAC, WAV, FLAC, OGG… En el modo DJ, **BIBLIOTECA** muestra las mismas canciones; pulsa **A** o **B** para cargarlas en un deck.

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
js/app.js               decks, mezclador, biblioteca, reproductor, grabación
js/native.js            integración con la app Android (servicio de reproducción, controles)
js/automix.js           mezcla automática entre canciones (crossfade + beatmatch) y cola
js/store.js             biblioteca guardada en el teléfono (IndexedDB): canciones, carpetas, cola
js/library-ui.js        panel de cola y biblioteca, menús, diálogos
js/analysis-worker.js   análisis de BPM en segundo plano (Web Worker)
js/deck-processor.js    motor de audio (AudioWorklet): tempo, scratch, loops
js/analysis.js          BPM, beat grid y forma de onda de 3 bandas
js/ui.js                perillas, faders y botones táctiles
sw.js, manifest.webmanifest, icons/   PWA (instalable y sin conexión)
android/                proyecto Android (Capacitor) + servicio de reproducción en segundo plano
capacitor.config.json   configuración de la app nativa
.github/workflows/      compilación automática del APK
```

Sin dependencias ni compilación: solo HTML, CSS y JavaScript con Web Audio API.
