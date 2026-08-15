# HeaderLab

[English](../README.md) | [한국어](README.ko.md) | [日本語](README.ja.md) | [中文](README.zh.md) | Español

Añade, modifica y elimina cabeceras HTTP de petición y respuesta, en Chrome, sin ningún
acceso a sitios hasta que tú lo concedas.

[![CI](https://github.com/say8425/headerlab/actions/workflows/ci.yml/badge.svg)](https://github.com/say8425/headerlab/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/headerlab?logo=npm&logoColor=%23CC3534&color=%23CC3534)](https://www.npmjs.com/package/headerlab)
[![Chrome MV3](https://img.shields.io/badge/Chrome-MV3-4285F4?style=flat&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](#licencia)

Un reemplazo de ModHeader, que fue retirado de la Chrome Web Store en julio de 2026 tras
descubrirse un rastreador oculto en él. Esa es toda la razón de que esto exista, y es por
lo que la postura de confianza de más abajo es una restricción dura y no una lista de
funciones.

| Claro | Oscuro |
|---|---|
| ![El popup de HeaderLab en tema claro: tres de cuatro reglas activas, dos sitios concedidos, cuatro reglas de cabecera](screenshots/popup-light.png) | ![El mismo popup en tema oscuro, que sigue la configuración del sistema operativo](screenshots/popup-dark.png) |

## Instalación

No hay ficha en la Chrome Web Store. Toma el zip adjunto a la última
[release](https://github.com/say8425/headerlab/releases) y descomprímelo, o constrúyelo tú
mismo:

```bash
corepack enable          # pnpm viene del campo packageManager de package.json
pnpm install
pnpm build               # → .output/chrome-mv3
```

Después abre `chrome://extensions`, activa el **Modo de desarrollador**, elige **Cargar
descomprimida** y selecciona ese directorio. Solo Chrome — mira
[Limitaciones](#limitaciones).

### La CLI

```bash
npm i -g headerlab
```

Eso pone `headerlab` en tu PATH, para manejar la extensión desde una terminal — mira
[Puente para agentes](#puente-para-agentes). También funciona directamente desde un clon,
sin ningún paso de instalación, porque el paquete no tiene dependencias en tiempo de
ejecución: `node packages/headerlab/bin/headerlab.mjs`. Pero la línea de arriba es como lo
usa una persona, y el clon es lo que hace quien contribuye; el orden es deliberado.

### La skill para agentes

`packages/plugin` empaqueta la CLI como una skill para Claude Code y para Codex, desde un
único árbol `skills/` bajo dos manifiestos. Ninguno está publicado en un directorio, así
que ambos se instalan desde este repositorio:

```bash
# Claude Code
claude plugin marketplace add say8425/headerlab
claude plugin install headerlab@headerlab

# Codex
codex plugin marketplace add say8425/headerlab
```

La skill ejecuta `command -v headerlab` antes de que su propio contenido llegue al modelo,
de modo que la ausencia de la CLI llega como un hecho y no como una sorpresa a mitad de
tarea. **Informa `bridge-off` hasta que el puente se enciende.** Instalar la CLI
globalmente no es un requisito previo: el plugin lleva su propio shim hacia
`packages/headerlab`. Ejecutar además `npm i -g headerlab` tampoco genera conflicto — el
PATH resuelve primero la copia global.

## Qué hace

- **Establece, añade o elimina** cualquier cabecera, del lado de la **petición** o de la
  **respuesta**. Chrome limita `append` a una lista de 21 cabeceras permitidas en las
  peticiones, y HeaderLab señala la regla que queda fuera de ella — lo cual importa más de
  lo que parece, porque Chrome rechaza el conjunto de reglas entero en lugar de regla por
  regla, así que una sola de esas detiene también todas las demás. Y no ocurre en silencio: el
  popup muestra el fallo de registro.
- **Ámbito por sitio.** Los sitios se emparejan por host: un puerto o una ruta se descartan
  al añadirlos, y el valor guardado es el valor que opera, así que lo que muestra el panel
  es lo que sale por el cable.
- **Aplicar en todas partes**, como un modo explícito y no como una lista de sitios vacía.
  Cuesta `<all_urls>`, y el interruptor no lo pide — lo pide el botón Grant que tiene al
  lado.
- **Filtrar por tipo de petición** — ocho de los tipos de recurso de Chrome, marcables uno a
  uno. `main_frame` viene activado, porque el valor por defecto de DNR lo excluye en
  silencio.
- **Pausar todo** con un interruptor. El icono de la barra se atenúa para acompañarlo, y se
  vuelve a aplicar cuando el service worker despierta.
- **Sigue el tema de tu sistema**, claro u oscuro, antes del primer pintado.

El acceso se pide por sitio, en la fila que nombra ese sitio — nunca como efecto colateral
de escribir un nombre de host o de accionar un interruptor. Hasta que pulsas **Grant**, la
fila está en ámbar y lo dice:

![Una fila de sitio para internal.example.com en estado pendiente, en ámbar, con un botón Grant](screenshots/popup-permission.png)

Cualquier cosa que impida que una regla salga se dice en la fila de esa misma regla, y se
cuenta en el panel. Aquí la segunda regla le pide a Chrome un `append` sobre una cabecera
de petición que no va a añadir — la fila dice cuál y qué hacer en su lugar, la lectura
marca **2 of 4 rules live · 1 off · 1 blocked**, y nada se mueve para hacerle sitio al
mensaje:

![La lista de reglas con la segunda fila mostrando "Use Set. Chrome does not append request headers." en rojo donde iría su valor, y el panel leyendo 2 of 4 rules live, 1 off, 1 blocked](screenshots/popup-blocked.png)

<sub>Capturado desde la build de producción real cargada en Chrome. Solo se parcheó el
manifiesto, para preconceder los dos hosts de ejemplo y poder fotografiar el estado
concedido sin un diálogo nativo de permisos.</sub>

## Postura de confianza

- **Ningún permiso de host en la instalación.** El campo `permissions` del manifiesto es
  exactamente `storage` y `declarativeNetRequestWithHostAccess`. También declara
  `optional_host_permissions: ["<all_urls>"]`, que por sí solo no concede nada — Chrome se
  niega a dejar que una extensión solicite un origen que nunca declaró, así que esa línea
  es lo que hace legal al botón Grant en tiempo de ejecución, no lo que lo hace
  innecesario. El acceso a sitios lo concedes tú, host por host, en tiempo de ejecución, y
  puede revocarse desde Chrome en cualquier momento.
- **Ninguna llamada de red.** Sin analítica, sin telemetría, sin configuración remota, sin
  pings de actualización. El bundle publicado nunca *llama* a una primitiva de red, y
  puedes comprobarlo tú mismo en lugar de creerlo:

  ```bash
  pnpm build
  grep -rE 'fetch\(|XMLHttpRequest|WebSocket|sendBeacon' .output/chrome-mv3
  ```

  Eso no devuelve nada. El patrón busca formas de llamada y de constructor a propósito: una
  búsqueda simple e insensible a mayúsculas de esas palabras aparece dieciséis veces
  en el bundle, y cada una de ellas es una cadena o un identificador y no una llamada — los
  `prefetchDNS`, `fetchPriority` y `dns-prefetch` de React DOM, y los literales
  `"xmlhttprequest"` y `"websocket"`. Esos dos son nombres de tipo de recurso de
  declarativeNetRequest, y llegan por vías distintas: `xmlhttprequest` es uno de los ocho
  que el popup ofrece como casillas (ahí etiquetado `xhr`), mientras que `websocket` solo
  existe como miembro del enum de quince tipos de recurso contra el que se valida el estado
  guardado. Se dice aquí
  para que encontrarlos se lea como algo esperado y no como una mentira descubierta.
- **Ningún content script.** No se inyecta nada en ninguna página. Las cabeceras las cambia
  el motor `declarativeNetRequest` de Chrome, que nunca entrega el contenido de las
  peticiones a la extensión.
- **Ningún recurso externo.** Sin CDN, sin fuentes web, sin imágenes remotas.
- **Ningún fallo silencioso.** Todo lo que impide que una regla salga se dice en pantalla —
  un permiso que falta, un nombre de host inservible, un nombre de cabecera que Chrome va a
  rechazar. Una regla que no se está aplicando siempre dice por qué.

## Puente para agentes

Un agente de IA puede manejar HeaderLab desde una terminal en lugar de que una persona
vaya haciendo clic por el popup:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

En una terminal imprime para personas; por una tubería o con `--json` imprime un único
objeto JSON, éxito o fallo. El código de salida nombra la clase de fallo:

| Código | Significado |
|---|---|
| `0` | Éxito |
| `2` | Tu entrada — la CLI la rechazó y nada salió de la máquina |
| `3` | No hay puente con el que hablar |
| `4` | Conectó, pero el intercambio falló |
| `1` | La extensión rechazó la petición |

```
CLI (headerlab)                      Native host              Extension (SW)
node, zero deps                       node, zero deps          lib/bridge/
   │                                      │                        │
   │  unix socket                         │  stdio                 │
   │  <per-user tmp>/headerlab/…sock      │  (4-byte length + JSON)│
   └──────── one JSON line ──────────────►├───────────────────────►│
            request/response              │                    apply()
   ◄──────────────────────────────────────┤◄───────────────────────┤
                                          │                   local:state
                                          │                        ▼
                                     Chrome launches         reconcile()
                                     and kills it        (existing single loop)
```

**La dirección es el único hecho que este diagrama existe para transmitir: el host no puede
hablarle primero a la extensión.** Chromium sí tiene una vía de conexión iniciada por el
lado nativo, pero vive detrás de un flag que se publica apagado, así que el diseño trata a
la extensión como el único iniciador. Ella abre el puerto, Chrome arranca el proceso host
como efecto colateral, el host escucha en un socket Unix, y quien se conecta a él es la CLI
— nunca al revés. Una escritura entra como una línea JSON, cruza hacia la extensión
enmarcada sobre stdio, se aplica a `local:state`, y la recoge el mismo `reconcile()` en el
que ya desembocan todos los demás disparadores: **un disparador nuevo, no un escritor
nuevo.**

### Comandos

Cuatro leen y no cambian nada: `status`, `site ls`, `rule ls` y `state get`. Envían una
única consulta y responden desde **las mismas funciones puras** con las que se pinta el
popup, así que lo que dice la CLI y lo que muestra la barra no pueden separarse.

```bash
headerlab status
headerlab state get --json | jq .state | headerlab state set - --force
```

`status` es el único comando que trata la ausencia de puente como un hecho y no como un
error — responde con lo que hay instalado localmente, dice `live: false` y sale con 0, igual
que `git status` en un repositorio sin commits. Los otros tres salen con 3.

Nueve viajan por el socket del puente como escrituras: `site add|rm` y
`site all-sites on|off` para acotar el conjunto de reglas, `rule add|rm|toggle` para editar
reglas de cabecera, `pause`/`resume` para parar y reanudar el conjunto entero, y
`state set <file|->` para reemplazar el estado guardado por completo — este último exige
`--force` cuando stdin no es una terminal, porque es una sobrescritura sin vuelta atrás.

Otros tres no tocan ese socket en absoluto — gestionan el manifiesto del host de native
messaging y el script lanzador que Chrome ejecuta, que es lo que hace posible el socket en
primer lugar: `bridge install`, `bridge uninstall` y `bridge status`. Este último informa
`entryMissing` cuando el lanzador apunta a un fichero que ya no está — el síntoma de un
`npm uninstall -g headerlab`, una actualización, o un cambio de nvm que mueve el prefijo
global. Volver a ejecutar `bridge install` lo arregla.

La referencia completa — flags y códigos de error — vive en
[`packages/plugin/skills/headerlab/SKILL.md`](../packages/plugin/skills/headerlab/SKILL.md).

### Cinco afirmaciones que conviene no malinterpretar

Son las afirmaciones del propio producto. Equivocarse aquí sería peor que omitir esta
sección.

- **El puente está apagado hasta que una persona lo enciende.** Va montado sobre
  `nativeMessaging` como permiso opcional, se solicita desde un botón del popup, detrás del
  propio diálogo de consentimiento de Chrome — la lista `permissions` de instalación no
  cambia. Medido, no supuesto:
  [`docs/research/2026-08-11-native-messaging-spike.md`](research/2026-08-11-native-messaging-spike.md)
  registra el diálogo apareciendo, y la concesión sobreviviendo a una segunda conexión sin
  diálogo alguno.
- **La CLI no puede conceder permisos de sitio.** `site add` y `site all-sites on` solo
  cambian a qué está *acotada* una regla — la fila sigue pendiente hasta que una persona
  pulsa **Grant**, igual que un sitio añadido a mano. Chrome exige un gesto del usuario para
  conceder un permiso, y ese límite se respeta en lugar de rodearse.
- **La CLI tampoco puede encender el puente.** `chrome.permissions.request()` necesita un
  gesto del usuario para resolverse. No hay `headerlab bridge enable` y no habrá uno que
  funcione: `bridge install` junto a un puente que nadie ha activado con **Enable** solo
  escribe ficheros que nunca conectan.
- **Nada sale de la máquina.** CLI, host y extensión solo hablan por un socket de dominio
  Unix en un directorio por usuario con permisos restringidos — nunca por un socket de red.
  **No `$TMPDIR`**, y la diferencia es deliberada: `socketDir()` le pregunta al sistema
  operativo (`getconf DARWIN_USER_TEMP_DIR`, por ruta absoluta) en vez de leer el `$TMPDIR`
  que cada proceso haya heredado, porque el host hereda el entorno de Chrome y la CLI el de
  la terminal — dos copias que pueden discrepar sin que nada falle para delatarlo. Sí hay
  una variable que lo sobrescribe, `HEADERLAB_SOCKET_DIR`, y se lee una sola vez *dentro* de
  esa función y no en cada punto de llamada, por la misma razón.
  `tests/unit/outbound.test.ts` prohíbe las primitivas salientes — `fetch`, `WebSocket`,
  `node:https`, una llamada `.listen(<número-de-puerto>)` — en todos los `.mjs` bajo
  `packages/headerlab/`, y su propio docblock dice lo que no puede ver: la comprobación de
  puerto casa con un dígito literal en el código, así que `server.listen(8080)` se detecta y
  `server.listen(tcpPort)` no. Escrito en vez de dejado implícito, porque exagerar una
  garantía de seguridad es lo único que este repositorio preferiría no hacer.
- **Esta build rechaza un filtro regex.** `state set` valida la carga, pero el popup no
  tiene editor de regex y aquí nada llama a
  `chrome.declarativeNetRequest.isRegexSupported()` — la única autoridad sobre si un patrón
  es RE2 válido — así que una regla con `filter.mode: 'regex'` se aplicaría de forma
  invisible, cambiando cabeceras sin que ninguna pantalla pueda mostrar el patrón
  responsable. `lib/bridge/port.ts` rechaza esa carga de plano, con el código de error
  `unsupported`, hasta que exista un editor de regex que la acompañe
  ([#33](https://github.com/say8425/headerlab/issues/33)).

### Cómo encenderlo

1. Pulsa **Enable** en la fila del puente del popup — hasta entonces lee **Bridge off**.
   Eso pide a Chrome el permiso `nativeMessaging` a través de su propio diálogo de
   consentimiento.
2. Ejecuta el instalador, copiando el id desde `chrome://extensions`:

   ```bash
   headerlab bridge install --extension-id <id>
   ```

3. El popup pasa a leer **Bridge live**.

`--extension-id` es la instrucción con la que también abre el README de la propia CLI,
porque es la que siempre aplica — quien instaló la CLI desde npm no tiene ningún directorio
de extensión al que apuntar. `--load-path <dir>` es la alternativa cuando trabajas sobre una
build local descomprimida y ya tienes la ruta a mano, pero es tanto una trampa como una
comodidad: un enlace simbólico, una barra final, o una ruta escrita de otra forma hacia el
mismo directorio producen cada uno un id distinto, y un manifiesto que no casa se instala
limpiamente y sencillamente no conecta nunca.

En cualquier caso el instalador devuelve exactamente el id que usó, porque nada dentro de la
CLI puede contrastarlo con lo que Chrome cargó de verdad. Comparar el id devuelto con
`chrome://extensions` es la única comprobación que existe — y `tests/e2e/bridge.spec.ts`
hace exactamente eso contra un navegador en marcha.

**Empaquetado.** `packages/headerlab` publica el comando `headerlab` **y** el host que
Chrome lanza como un único paquete y no como dos. `bridge install` escribe un lanzador que
nombra el fichero de entrada del host por ruta absoluta; una CLI publicada sin el host
escribiría ese lanzador igualmente — el paso de instalación no puede ver que el fichero que
nombra no existe en la máquina de destino — y Chrome informa del fallo resultante con el
mismo mensaje que usa para un manifiesto rechazado o un id que no casa. Publicar ambos desde
el mismo tarball vuelve ese modo de fallo estructuralmente imposible en lugar de meramente
documentado.

De lo que nombraba el §2/§3 del propio diseño, dos cosas siguen sin existir: `headerlab
diagnostics`, que no se va a construir porque `status` ya lleva la misma carga y un segundo
nombre para una sola consulta no es una función, y el snapshot-antes-de-cada-escritura-cruda
que leerían `state snapshots`/`state restore <id>`
([#35](https://github.com/say8425/headerlab/issues/35)). `state set` valida contra el
esquema y exige `--force`; no guarda ningún historial.

## Arquitectura

```
lib/model/       tipos, esquema zod, valores por defecto, migraciones   puro
lib/compile/     AppState → reglas DNR + diagnósticos                   puro
lib/permissions/ origins.ts, audit.ts puros · probe.ts llama al navegador
lib/view/        modelos de vista del popup                             puro
lib/bridge/      protocol.ts (esquema de comandos), apply.ts (reducer)   puro
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
lista de diagnósticos, y el popup ejecuta esa misma función sobre ese mismo estado — de
modo que lo que dice la pantalla y lo que se le dijo al navegador no pueden discrepar.

**Un único bucle de reconciliación.** Cada disparador — un cambio en el almacenamiento, el
arranque del worker, un permiso concedido o revocado — desemboca en `reconcile()` dentro de
`lib/sync/ruleSync.ts`, que recompila desde cero y reemplaza el conjunto de reglas entero.
Es idempotente, y no hay un segundo camino por el que el estado pueda colarse hacia abajo.

Esta forma es forzada, no elegida: `@webext-core/fake-browser` implementa
`declarativeNetRequest` y `permissions.*` como stubs que lanzan excepciones, así que probar
imitando al navegador no es viable. Hacer que el navegador sea irrelevante para la lógica
es la respuesta a eso.

Los documentos de diseño viven en `docs/superpowers/specs/`, y las restricciones de
plataforma medidas que hay detrás, en `docs/research/`.

## Limitaciones

**Esto es una build de Chrome MV3 y nada más.** `wxt.config.ts` no declara ningún otro
objetivo, y no se ha ejecutado ninguna build en otro navegador. Edge es el mismo motor y
debería funcionar, pero nadie ha pasado la suite contra él.

La tabla de abajo es *el techo de plataforma con el que se toparía un port*, no una matriz
de compatibilidad — son los
[datos de compatibilidad de MDN](https://github.com/mdn/browser-compat-data) para las APIs
sobre las que está construida esta extensión, leídos en la versión en que cada navegador
las publicó por primera vez. La columna de Edge es `✓` y no un número porque BCD la
registra como `mirror` — sigue a la de Chrome:

| | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Cabeceras de petición (`RuleAction.requestHeaders`) | 86 | ✓ | 113 | 16.4 |
| Cabeceras de respuesta (`RuleAction.responseHeaders`) | 86 | ✓ | 113 | **ninguna** |
| Concesión por sitio en runtime (`optional_host_permissions`) | 102 | ✓ | 128 | 15.5 |
| Reglas por pestaña (`RuleCondition.tabIds`) | 92 | ✓ | 113 | **ninguna** |
| Native messaging (`runtime.connectNative`) | 29 | ✓ | 50 | 14 (app contenedora) |

Dos de ellas merecen deletrearse:

- **Safari no puede modificar cabeceras de respuesta en absoluto.** Eso es la mitad de lo
  que hace esta extensión, así que un port a Safari sería un producto distinto y más
  pequeño, no el mismo recompilado.
- **El native messaging de Safari va hacia una app de macOS contenedora**, según el modelo
  documentado por Apple, y no hacia un manifiesto de host en disco. `headerlab bridge
  install` escribe exactamente ese manifiesto, así que allí no tiene dónde instalarse.

Las funciones deliberadamente no construidas todavía se siguen como issues:
[#30](https://github.com/say8425/headerlab/issues/30) un único conjunto de reglas ·
[#31](https://github.com/say8425/headerlab/issues/31) importar/exportar JSON ·
[#32](https://github.com/say8425/headerlab/issues/32) UI de bloqueo por pestaña ·
[#33](https://github.com/say8425/headerlab/issues/33) ámbito por regex ·
[#34](https://github.com/say8425/headerlab/issues/34) selector manual de tema ·
[#35](https://github.com/say8425/headerlab/issues/35) los comandos que le faltan al puente.

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
```

**pnpm, no npm.** `package.json` nombra la versión exacta bajo `packageManager`, así que
`corepack enable` te da esa y no hace falta instalar nada más. No hay
`package-lock.json`; `pnpm-lock.yaml` es el lockfile desde el que CI instala con
`--frozen-lockfile`.

**Ejecuta `pnpm test`, no un `pnpm exec vitest run` pelado.** Varias suites hacen
aserciones contra la salida *construida*, y las herramientas peladas no construyen. Un
artefacto obsoleto ha producido tanto un verde falso que desactivó un guard en silencio
como un rojo falso que costó una hora, así que `tests/support/build.ts` detecta la
obsolescencia y falla indicando el comando a ejecutar.

**`pnpm test:e2e` y `pnpm screenshots` necesitan un navegador que Playwright no instala por
defecto:**

```bash
pnpm exec playwright install --with-deps --no-shell chromium
```

`--no-shell` importa. La descarga headless por defecto de Playwright es
`chromium-headless-shell`, una build recortada que no puede cargar extensiones — y esos dos
comandos existen precisamente para cargar una. Sin el binario completo fallan de una forma
que parece un problema de código y no una dependencia que falta.

**`pnpm screenshots` sobrescribe los PNG versionados** de `docs/screenshots/`. Ese es su
trabajo, pero significa que una ejecución deja cambios en `git status`; haz commit de ellos
solo cuando la UI haya cambiado de verdad.

**La build de e2e lleva un permiso de host que la build publicada no tiene, y dada la
primera afirmación de esta página merece decirse en voz alta.** `pnpm test:e2e` construye
en `.output/chrome-mv3-e2e` y `.output/chrome-mv3-bridge-e2e`, junto al directorio de
producción. El primero declara `http://127.0.0.1/*` (`wxt.config.ts`) para que la suite
pueda usar un servidor de eco local sin un diálogo en tiempo de ejecución que Playwright no
puede pulsar, y el segundo concede `nativeMessaging` directamente.
`tests/unit/manifest.test.ts` afirma que ninguno de los dos llega nunca a producción, y
ejecutar la suite e2e no toca `.output/chrome-mv3` — usa `pnpm build` para una build de
producción fresca.

`../CLAUDE.md` lleva el resto: por qué `lint` encadena `wxt prepare`, por qué
`postinstall` puede no ejecutarse nunca, qué formatea y qué no formatea oxfmt, y las
trampas de plataforma que ya le han costado tiempo a alguien.

## Tests

Tres capas: lógica pura sin navegador, adaptadores movidos por spies puestos a mano, y
end-to-end contra una extensión realmente cargada. Dos de los dieciséis tests e2e ponen una
petición real en el cable a través de un servidor de eco local y leen las cabeceras de
vuelta — son la evidencia más fuerte del repositorio.

En el momento de escribir esto: 820 tests unitarios repartidos en 38 ficheros, más 16 e2e —
cuatro de ellos son del propio puente, incluido uno que lleva un `headerlab site add` real a
través de un host realmente instalado, a través del socket, hasta el almacenamiento real.
`packages/headerlab` aporta otros 140, ejecutados por el runner de tests incorporado de Node
y no por vitest, porque ese paquete no tiene dependencias y no debería adquirir ninguna. El
glob de `vitest.config.ts` no llega hasta ellos, que es por lo que tienen un job de CI
propio: durante un tiempo se estuvieron mergeando sin ejecutarse, y una suite que nadie
ejecuta es peor que una que no existe, porque informa de éxito.

## Licencia

Apache-2.0. Mira [LICENSE](../LICENSE).
