# HeaderLab

[English](../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh.md) | Español

Añade, modifica y elimina cabeceras HTTP de petición y respuesta en Chrome. No tiene acceso
a ningún sitio hasta que tú se lo concedes.

[![Chrome Web Store](https://img.shields.io/chrome-web-store/v/kgapijlldieckifoenckgninnepafhnn?logo=googlechrome&logoColor=%234285F4&color=%234285F4&label=chrome%20web%20store)](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn)
[![CLI](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534&label=cli)](https://www.npmjs.com/package/headerlab)
[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)

| Claro | Oscuro |
|---|---|
| ![El popup de HeaderLab en tema claro: el recuento junto al encabezado Rules lee 3 of 4 live, 1 off, con dos sitios concedidos en el panel lateral y cuatro reglas de cabecera](screenshots/popup-light.png) | ![El mismo popup en tema oscuro. Sigue la configuración del sistema operativo](screenshots/popup-dark.png) |

## Instalación

Por ahora solo Chrome. Firefox y Safari están previstos.

### Chrome Web Store

Se recomienda instalarla desde la
[Chrome Web Store](https://chromewebstore.google.com/detail/headerlab/kgapijlldieckifoenckgninnepafhnn).

### Página de releases

Cada release `extension-v*` adjunta `headerlab-<version>-chrome.zip`. Descarga el asset de
la versión que quieras desde la
[página de releases](https://github.com/say8425/headerlab/releases) y descomprímelo. Luego
`chrome://extensions` → **Modo de desarrollador** → **Cargar descomprimida** → el
directorio descomprimido.

### Constrúyelo tú mismo

```bash
corepack enable          # pnpm viene del campo packageManager de package.json
pnpm install
pnpm build               # → .output/chrome-mv3
```

Carga `.output/chrome-mv3` de la misma forma.

## AI

Un agente de programación de IA puede manejar HeaderLab. Son tres piezas que se apilan: una
CLI que una persona también puede usar a mano, una skill que le enseña al agente a usarla, y
el puente que conecta cualquiera de las dos con la extensión en ejecución. Nada de esto está
activado por defecto, y nada de esto puede activarse solo. El último párrafo de la sección
explica por qué.

### La CLI

```bash
npm i -g headerlab
```

Eso deja `headerlab` en tu PATH para manejar la extensión desde una terminal. Mira
[Puente para agentes](#puente-para-agentes). El paquete no tiene dependencias en tiempo de
ejecución, así que también se ejecuta desde un clon sin ningún paso de instalación:
`node packages/headerlab/bin/headerlab.mjs`. El orden es deliberado: la línea de arriba es
como lo usa una persona, y el clon es lo que hace quien contribuye.

### La skill para agentes

`packages/plugin` empaqueta la CLI como skill para Claude Code y para Codex: un único árbol
`skills/` bajo dos manifiestos. Ninguno de los dos está publicado en un directorio, así que
ambos se instalan desde este repositorio:

```bash
# Claude Code
claude plugin marketplace add say8425/headerlab
claude plugin install headerlab@headerlab

# Codex
codex plugin marketplace add say8425/headerlab
```

La skill ejecuta `command -v headerlab` antes de que su propio contenido llegue al modelo,
de modo que la falta de la CLI se sabe de antemano y no aparece como sorpresa a mitad de
tarea. **Informa `bridge-off` hasta que se enciende el puente.** No hace falta instalar la
CLI globalmente: el plugin lleva su propio shim hacia `packages/headerlab`. Ejecutar además
`npm i -g headerlab` tampoco genera conflicto, porque el PATH resuelve primero la copia
global.

Pídelo con tus propias palabras; la skill traduce la petición a la CLI:

```text
¿Qué está haciendo HeaderLab ahora mismo?
Añade una cabecera de petición X-Debug: on solo en staging.example.com
Deja de enviar la cabecera Referer en api.example.com
Pausa todas las reglas y luego vuelve a activarlas
¿En qué sitios se me permite modificar realmente?
```

La primera y la última son lecturas: `status`, `site ls`, `rule ls` y `state get` responden
sin escribir nada. Las tres del medio escriben. Conviene contar con un detalle: añadir un
sitio delimita el alcance de la regla, pero no concede acceso a ese sitio. El sitio queda
pendiente hasta que pulses Grant en el popup. La skill tiene indicado decirlo, para que no
leas la escritura como si el sitio ya estuviera activo.

### Puente para agentes

El puente es lo que lleva cualquiera de las dos piezas anteriores hasta la extensión en
ejecución:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

El puente está apagado hasta que una persona activa su interruptor en el popup. La CLI no
puede conceder acceso a sitios ni encenderlo: Chrome acepta ambas cosas solo desde un gesto
del usuario. Nada sale de la máquina. La CLI, el host y la extensión se encuentran en un
socket de dominio Unix dentro de un directorio por usuario, nunca en un socket de red.

[`docs/agent-bridge.es.md`](agent-bridge.es.md) lo cubre entero: el protocolo, los
comandos, los códigos de salida, cómo encenderlo y las cinco afirmaciones que conviene no
malinterpretar.

## Qué hace

- **Establece, añade o elimina** cualquier cabecera, del lado de la **petición** o de la
  **respuesta**. En las peticiones, Chrome limita `append` a una lista de 21 cabeceras
  permitidas, y HeaderLab señala la regla que se queda fuera. Importa más de lo que parece:
  Chrome rechaza el conjunto de reglas entero en lugar de regla por regla, así que una sola
  de esas detiene también todas las demás. Y no ocurre en silencio; el popup muestra el
  fallo de registro.
- **Ámbito por sitio.** Los sitios se emparejan por host. Al añadir uno se descarta el
  puerto o la ruta, y el valor guardado es el valor que opera, así que lo que muestra el
  panel es lo que sale por el cable.
- **Aplicar en todas partes**, como modo explícito y no como una lista de sitios vacía.
  Cuesta `<all_urls>`, y el interruptor no lo pide; lo pide el botón Grant que tiene al
  lado.
- **Filtrar por tipo de petición.** Ocho de los tipos de recurso de Chrome, marcables uno a
  uno. `main_frame` viene activado, porque el valor por defecto de DNR lo excluye en
  silencio.
- **Pausar todo** con un interruptor. El icono de la barra se atenúa a juego, y se vuelve a
  aplicar cuando el service worker despierta.
- **Sigue el tema de tu sistema**, claro u oscuro, antes del primer pintado.

El acceso se pide por sitio, en la fila que nombra ese sitio, y nunca como efecto colateral
de escribir un nombre de host o de accionar un interruptor. Hasta que pulsas **Grant**, la
fila está en ámbar y lo dice. El recuento junto al encabezado **Rules** tampoco adorna ese
estado. Una regla que solo alcanza a hosts que no has concedido se cuenta como **blocked**,
y nunca como live. Los hosts que siguen esperando aparecen nombrados a su lado. El recuento
se mantiene honesto por ambos extremos ("3 of 4 live · 1 off · 1 site needs access"):

![La fila del sitio internal.example.com en estado pendiente, en ámbar, con un botón Grant, y el recuento junto al encabezado Rules leyendo 3 of 4 live, 1 off, 1 site needs access](screenshots/popup-permission.png)

Todo lo que impida que una regla salga se dice en la fila de esa misma regla, y se cuenta
junto al encabezado **Rules**. Aquí la segunda regla le pide a Chrome un `append` sobre una cabecera de
petición que no va a añadir. La fila dice cuál es y qué hacer en su lugar, la lectura marca
**2 of 4 live · 1 off · 1 blocked**, y nada se mueve para hacerle sitio al mensaje:

![La lista de reglas con la segunda fila mostrando "Use Set. Chrome does not append request headers." en rojo donde iría su valor, y el recuento junto al encabezado Rules leyendo 2 of 4 live, 1 off, 1 blocked](screenshots/popup-blocked.png)

<sub>Capturado desde la build de producción real cargada en Chrome. Lo único parcheado fue
el manifiesto, para preconceder los dos hosts de ejemplo y poder fotografiar el estado
concedido sin un diálogo nativo de permisos.</sub>

## Postura de confianza

- **Ningún permiso de host en la instalación.** El campo `permissions` del manifiesto es
  exactamente `storage` y `declarativeNetRequestWithHostAccess`. También declara
  `optional_host_permissions: ["<all_urls>"]`, que por sí solo no concede nada: Chrome no
  deja que una extensión solicite un origen que nunca declaró, así que esa línea es lo que
  hace legal el botón Grant en tiempo de ejecución, no lo que lo hace innecesario. El
  acceso a los sitios lo concedes tú, host por host, en tiempo de ejecución, y puede
  revocarse desde Chrome en cualquier momento.
- **Ninguna llamada de red.** Sin analítica, sin telemetría, sin configuración remota, sin
  pings de actualización. El bundle publicado nunca *llama* a una primitiva de red, y
  puedes comprobarlo tú mismo en lugar de creerlo:

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  Eso no devuelve nada. El patrón busca a propósito las formas de llamada y de constructor.
  Una búsqueda simple de esas palabras, sin distinguir mayúsculas, sí las encuentra
  dieciséis veces en el bundle, y todas son cadenas o identificadores, no llamadas: los
  `prefetchDNS`, `fetchPriority` y `dns-prefetch` de React DOM, y los literales
  `"xmlhttprequest"` y `"websocket"`. Estos dos últimos son nombres de tipo de recurso de
  declarativeNetRequest, y llegan por vías distintas. `xmlhttprequest` es uno de los ocho
  que el popup ofrece como casillas, ahí etiquetado `xhr`. `websocket` solo existe como
  miembro del enum de quince tipos de recurso contra el que se valida el estado guardado.
  Se dice aquí para que encontrarlos resulte esperable y no parezca una mentira
  descubierta.
- **Ningún content script.** No se inyecta nada en ninguna página. Las cabeceras las cambia
  el motor `declarativeNetRequest` de Chrome, que nunca entrega el contenido de las
  peticiones a la extensión.
- **Ningún recurso externo.** Sin CDN, sin fuentes web, sin imágenes remotas.
- **Ningún fallo silencioso.** Todo lo que impide que una regla salga se dice en pantalla:
  un permiso que falta, un nombre de host inservible, un nombre de cabecera que Chrome va a
  rechazar. Una regla que no se está aplicando siempre dice por qué.

## Limitaciones

Los detalles están en los
[datos de compatibilidad de MDN](https://github.com/mdn/browser-compat-data).

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Cabeceras de petición (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| Cabeceras de respuesta (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **ninguna** |
| Concesión por sitio en runtime (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| Reglas por pestaña (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **ninguna** |
| Native messaging (`runtime.connectNative`) | 29 | ✓ | 50 | 14 (app contenedora) |

## Arquitectura

```
lib/model/       tipos, esquema zod, valores por defecto, migraciones   puro
lib/compile/     AppState → reglas DNR + diagnósticos                   puro
lib/permissions/ origins.ts, audit.ts puros · probe.ts llama al navegador
lib/view/        modelos de vista del popup                             puro
lib/bridge/      protocol.ts (esquema de comandos), apply.ts (reducer),
                 query.ts (estado → StatusPayload)                        puro
lib/storage/     state.ts, session.ts, useAppState.ts
lib/sync/        ruleSync.ts (reconcile), icon.ts
components/      UI del popup
entrypoints/     background.ts, popup/
packages/        el puente para agentes, fuera del bundle de la extensión —
                 headerlab (la CLI más el host de native messaging,
                 publicado en npm), plugin. Cero dependencias, node:test,
                 su propio job de CI
```

**Toda la corrección vive en una capa pura que nunca importa `chrome.*`.** `compile()`
convierte el estado completo de la aplicación en reglas de declarativeNetRequest más una
lista de diagnósticos. El popup ejecuta esa misma función sobre ese mismo estado, así que
lo que dice la pantalla y lo que se le dijo al navegador no pueden discrepar.

**Un único bucle de reconciliación.** Todos los disparadores desembocan en `reconcile()`,
dentro de `lib/sync/ruleSync.ts`: un cambio en el almacenamiento, el arranque del worker,
un permiso concedido o revocado. Esa función recompila desde cero y reemplaza el conjunto
de reglas entero. Es idempotente, y no hay un segundo camino por el que el estado pueda
colarse hacia abajo.

Esta forma es forzada, no elegida. `@webext-core/fake-browser` implementa
`declarativeNetRequest` y `permissions.*` como stubs que lanzan excepciones, así que probar
imitando al navegador no es viable. La respuesta es hacer que el navegador sea irrelevante
para la lógica.

Los documentos de diseño están en `docs/superpowers/specs/`. Las restricciones de
plataforma medidas que hay detrás están en `docs/research/`.

## Desarrollo

```bash
pnpm dev             # servidor de desarrollo de WXT → carga .output/chrome-mv3-dev
pnpm check           # cuatro de los seis jobs de CI: tipos · lint · formato · unitarios
pnpm test            # wxt build && vitest run — tests unitarios, sin navegador
pnpm test:packages   # los paquetes del puente, bajo node:test — el glob de vitest
                     # no llega hasta ellos, así que es su propio job de CI
pnpm check:all       # pnpm check && pnpm test:packages
pnpm test:e2e        # construye los dos modos e2e y lanza playwright test
pnpm typecheck       # wxt prepare && tsc --noEmit
pnpm lint            # wxt prepare && oxlint --deny-warnings   (lint:fix arregla)
pnpm format:check    # oxfmt --check             (pnpm format para escribir)
pnpm build           # build de producción → .output/chrome-mv3
pnpm screenshots     # regenera las imágenes de este README desde el popup real
pnpm store:assets    # regenera las 8 imágenes de la Chrome Web Store → docs/store/assets/
```

**pnpm, no npm.** `package.json` nombra la versión exacta en `packageManager`, así que
`corepack enable` te da esa y no hace falta instalar nada más. No hay `package-lock.json`.
El lockfile es `pnpm-lock.yaml`, y CI instala desde él con `--frozen-lockfile`.

**Ejecuta `pnpm test`, no un `pnpm exec vitest run` a secas.** Varias suites hacen
aserciones contra la salida *construida*, y las herramientas sueltas no construyen. Un
artefacto obsoleto ya ha producido un verde falso que desactivó un guard en silencio y un
rojo falso que costó una hora. Por eso `tests/support/build.ts` detecta la obsolescencia y
falla indicando el comando a ejecutar.

**`pnpm test:e2e`, `pnpm screenshots` y `pnpm store:assets` necesitan un navegador que
Playwright no instala por defecto:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` importa. La descarga headless por defecto de Playwright es
`chromium-headless-shell`, una build recortada que no puede cargar extensiones, y esos dos
comandos existen precisamente para cargar una. Sin el binario completo fallan de una forma
que parece un problema de código y no una dependencia que falta.

**`pnpm screenshots` y `pnpm store:assets` sobrescriben los PNG versionados**, en
`docs/screenshots/` y `docs/store/assets/` respectivamente; el segundo vacía su directorio
antes de reescribir las 8. Ese es su trabajo, pero significa que cada ejecución deja
cambios en `git status`. Haz commit de ellos solo cuando la UI haya cambiado de verdad.

**La build de e2e lleva un permiso de host que la build publicada no tiene. Dada la primera
afirmación de esta página, merece decirse en voz alta.** `pnpm test:e2e` construye en
`.output/chrome-mv3-e2e` y `.output/chrome-mv3-bridge-e2e`, junto al directorio de
producción. El primero declara `http://127.0.0.1/*` (`wxt.config.ts`) para que la suite
pueda usar un servidor de eco local sin un diálogo en tiempo de ejecución que Playwright no
puede pulsar. El segundo concede `nativeMessaging` directamente.
`tests/unit/manifest.test.ts` afirma que ninguno de los dos llega nunca a producción.
Ejecutar la suite e2e no toca `.output/chrome-mv3`: para una build de producción fresca,
usa `pnpm build`.

El resto está en `../CLAUDE.md`: por qué `lint` encadena `wxt prepare`, por qué
`postinstall` puede no ejecutarse nunca, qué formatea oxfmt y qué no, y las trampas de
plataforma que ya le han costado tiempo a alguien.

## Tests

Hay tres capas: lógica pura sin navegador, adaptadores movidos por spies puestos a mano, y
end-to-end contra una extensión realmente cargada. Dos de los tests e2e ponen una petición
real en el cable a través de un servidor de eco local y leen las cabeceras de vuelta. Son
la evidencia más fuerte del repositorio. El puente tiene los suyos, incluido uno que lleva
un `headerlab site add` real a través de un host realmente instalado, por el socket, hasta
el almacenamiento real.

`packages/headerlab` aporta una suite propia. La ejecuta el runner de tests incorporado de
Node y no vitest, porque ese paquete no tiene dependencias y no debería adquirir ninguna.
El glob de `vitest.config.ts` no llega hasta ellos, y por eso tienen un job de CI propio:
durante un tiempo se estuvieron mergeando sin ejecutarse, y una suite que nadie ejecuta es
peor que una que no existe, porque informa de éxito.

## Licencia

Apache-2.0. Mira [LICENSE](../LICENSE).
