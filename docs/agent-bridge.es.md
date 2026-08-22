# Puente para agentes

[English](agent-bridge.md) | [한국어](agent-bridge.ko.md) | [日本語](agent-bridge.ja.md) | [中文](agent-bridge.zh.md) | Español

Parte de [HeaderLab](README.es.md).

Un agente de IA puede manejar HeaderLab desde una terminal en lugar de que una persona
vaya haciendo clic por el popup:

```bash
headerlab site add staging.example.com
headerlab rule add --target request --op set --name Authorization --value "Bearer $TOKEN"
```

En una terminal imprime para personas; por una tubería o con `--json` imprime un único
objeto JSON, éxito o fallo. `--human` es el inverso de `--json`: fuerza la forma legible
por personas incluso a través de una tubería, que es lo que quieres cuando un registro lo
va a leer una persona en vez de analizarlo una máquina. Pasar ambos es una contradicción
y no una cuestión de precedencia, así que la CLI lo rechaza y sale con 2 sin hacer nada.
El código de salida nombra la clase de fallo:

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

## Comandos

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

## Cinco afirmaciones que conviene no malinterpretar

Son las afirmaciones del propio producto. Equivocarse aquí sería peor que omitir este
documento.

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
  funcione: `bridge install` solo escribe el manifiesto, y nada conecta hasta que una
  persona activa el interruptor.
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

## Cómo encenderlo

1. Ejecuta el instalador, copiando el id desde `chrome://extensions`:

   ```bash
   headerlab bridge install --extension-id <id>
   ```

2. Activa el interruptor en la fila del puente del popup — hasta entonces lee **Agent bridge off**.
   Eso pide a Chrome el permiso `nativeMessaging` a través de su propio diálogo de
   consentimiento.

3. El popup pasa a leer **Agent bridge live**.

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
