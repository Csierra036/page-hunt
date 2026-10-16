# Page Hunt

Videojuego de navegador: escribes una URL, esa página se convierte en el escenario y la destruyes a tiros, al estilo de Duck Hunt mezclado con [destroy.spritefusion.com](https://destroy.spritefusion.com/). Disparas con el ratón, recargas y cazas patos que, al caer, se estrellan contra la página.

El juego **no finge una compatibilidad universal**. Según lo que el navegador permite de verdad con cada URL, usa uno de tres modos y siempre muestra cuál es en el HUD.

## Ejecución local

Requisitos: Node 18 o superior y, para el modo de simulación visual, Chromium o Chrome instalado. Se busca en las rutas habituales; si no lo encuentra, define `CHROMIUM_PATH`.

```bash
cd page-hunt
npm install
npm run dev          # http://localhost:5173
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo con la API local del juego |
| `npm run build` | Comprobación de tipos y build en `dist/` (juego + página de prueba) |
| `npm run preview` | Sirve `dist/` con la misma API local |
| `npm test` | Pruebas unitarias (Vitest) |
| `npm run test:e2e` | Pruebas de extremo a extremo en Chromium real; dejan capturas y `results.json` en `tests/e2e/out/` |

> La API (`/api/probe`, `/api/capture`) es un middleware de Vite y solo existe con `dev` o `preview`. Si se sirve `dist/` con otro servidor estático, solo funciona el modo DOM real.

## Controles

| Acción | Control |
| --- | --- |
| Apuntar / disparar | Ratón / clic izquierdo (táctil: tocar). También Espacio o Intro |
| Recargar | **R** (configurable en Ajustes). En táctil, botón RECARGAR |
| Recarga perfecta | Pulsar otra vez la tecla de recarga cuando la barra está en la zona verde |
| Coger un arma bonus | Disparar a la caja (o a su paracaídas) mientras baja: cae y te da el arma al tocar el suelo |
| Desplazar la página | Rueda, **clic derecho (o central) + arrastrar**, flechas, Re Pág / Av Pág. Táctil: arrastrar el dedo (tocar sin arrastrar dispara) |
| Pausa / sonido | P o Esc / M |

## Mecánicas

- **Estilo pixel art**: grietas, agujeros, anillos de impacto, polvo y patos están hechos de bloques. Los elementos dañados pierden trozos en escalera por los bordes y se rompen en bloques cuadrados que caen sin girar. En el modo DOM real, las caídas y sacudidas van a saltos (`steps()`).
- **La mira es el arma**: no hay arma dibujada. Junto a la mira se ven los cartuchos que quedan, el arco de recarga con la zona verde de la recarga perfecta y una "R" parpadeante cuando el cargador está vacío. Al disparar, la mira salta por el retroceso. Con ratón no hay caja de munición abajo; en táctil sí, con botones.
- **Escopeta (arma base)**: 6 cartuchos, 7 perdigones con dispersión y 1 de daño por perdigón. Es la única que se recarga.
- **Armas bonus (estilo Metal Slug)**: los patos abatidos pueden soltar una caja con letra que baja en paracaídas: los dorados siempre, el pato bonus la mitad de las veces y los normales un 30 % (más durante un jefe). Si le disparas, el paracaídas se corta, la caja cae por gravedad y al tocar el suelo te da el arma. Si no le disparas, aterriza, parpadea y desaparece. Las armas bonus tienen balas limitadas, no se recargan y se desechan al vaciarse, y vuelves a la escopeta. Otra caja de la misma letra suma un cargador.
  - **H · Ametralladora**: 60 balas, automática (mantén el clic).
  - **R · Lanzacohetes**: 6 cohetes que explotan siempre donde impactan, sea un pato, el jefe, una caja o la página. La explosión alcanza a todos los patos del radio, al jefe y sus proyectiles, corta los paracaídas cercanos y daña la página.
  - **S · Francotirador**: 8 balas de 12 de daño, ideal contra imágenes grandes y jefes.
- **Sonido**: el disparo y la recarga de la escopeta usan las grabaciones de `src/assets/sfx/`. El francotirador y la ametralladora usan la misma grabación, acelerada. El resto (patos, impactos, roturas, fanfarria) es sintetizado con WebAudio, que también sirve de respaldo si las grabaciones no cargan.
- **Recarga**: solo recarga, no daña la página. No se permite con el cargador lleno, y mientras dura no se puede disparar. La excepción es la **recarga activa**: si se pulsa de nuevo en la zona verde, termina al instante y da puntos extra; si se pulsa fuera, el arma se encasquilla y la recarga dura un 60 % más.
- **Daño progresivo**: cada elemento tiene puntos de vida según su tamaño. Pasa por arañado → agrietado y descolorido → deformado → roto (cae y se fragmenta). Los impactos y las grietas son acumulativos.
- **Imágenes resistentes**: las imágenes y los fondos pintados grandes ganan vida con su tamaño, hasta 120 puntos (`hpForImage` en `src/core/damage.ts`). Un texto normal tiene entre 2 y 24. Por ejemplo, la imagen del hero de eddyverso.com (1280×800) aguanta 34 disparos de escopeta. El choque de un pato solo remata elementos agrietados con poca vida, nunca una imagen grande.
- **Patos**: oleadas tipo Duck Hunt en una capa propia. Los disparos que no los alcanzan atraviesan hasta la página, así que nunca la bloquean. Un pato abatido cae y se estrella contra la página, causando daño de área. Hay patos dorados que valen más. Los **patos bonus** (rosa, parpadeando) desatan una bandada extra; dejar escapar a esos patos no penaliza.
- **Puntuación**: puntos por daño, por elementos rotos y por patos. El multiplicador sube con impactos consecutivos (hasta ×8) y se pierde al fallar o si escapa un pato. Una ronda perfecta da bonificación.
- **Rondas y jefes**: cada ronda trae más patos, más rápidos y que escapan antes (`src/core/score.ts`). La partida tiene un máximo de 20 rondas. En las rondas 5, 10, 15 y 20 aparece un jefe (`src/fx/bosses.ts`), la ronda no avanza hasta vencerlo y los patos siguen saliendo como apoyo con sus cajas de armas:
  - **Mamá Pato**: cruza el cielo soltando huevos. Hay que derribarlos: si un huevo llega al suelo pierdes un corazón y revienta la página. De vez en cuando llama a más patos.
  - **Halcón Ninja**: lanza plumas teledirigidas, marca la posición de tu mira en rojo y se lanza en picado contra ella. Aparta la mira o dispárale durante el picado, que recibe doble daño.
  - **Mecha-Pato**: blindado; los disparos rebotan. Lanza cohetes teledirigidos y barre con un láser la fila de tu mira tras avisarte con una franja roja. Solo se le puede herir mientras su núcleo se ventila tras el láser.
  - **Rey Fantasma**: se teletransporta dejando señuelos idénticos, se vuelve intangible al desvanecerse y dispara anillos de orbes. **Los señuelos también disparan los suyos**, así que no se distingue al real por quién dispara: cada clon lanza 2 orbes menos, algo más lentos y girados, para dejar huecos. Solo el auténtico recibe daño.
  - Al perder vida, los jefes muestran heridas cada vez peores (venda, grietas, moratones, humo y chispas). Por debajo de un tercio se ponen **furiosos** y atacan más rápido. Todos sus proyectiles se pueden derribar a tiros.
- **Corazones de recuperación**: con muy baja probabilidad, un pato abatido suelta una caja con un corazón pixel: 3 % los normales, 6 % el pato bonus, 12 % el dorado y 2 % los de bandada bonus. Puede salir en cualquier ronda. Se recoge igual que las armas y da +1 corazón (máximo 3); si ya tienes los 3, da 500 puntos.
- **Patos aliados**: solo durante un jefe, el 40 % de las cajas que sueltan los patos son **"A" (verdes)**. Se recogen igual que las armas, y al aterrizar aparece un pato aliado con gafas de sol durante 15 s. Dispara solo cada 0,6 s: primero a los proyectiles del jefe (para protegerte) y, si no hay, al jefe. Sigue las mismas reglas que tus balas, falla un 15 % de las veces y no recibe daño. Puede haber hasta 3 a la vez, y otra caja con 3 en pantalla renueva el tiempo del más antiguo. Se retiran cuando cae el jefe (`src/fx/allies.ts`).
- **Corazones**: empiezas con 3. Los pierdes si te alcanza un ataque de jefe, y después tienes 1,5 s de invulnerabilidad. Vencer a un jefe devuelve uno y suelta dos cajas de armas.
- **Avance y finales**: la barra superior muestra el **avance hacia completar las 20 rondas**. Cada ronda vale un 5 %; dentro de una ronda avanza según resuelves la oleada (o la vida que le quitas al jefe). Tiene una marca en cada ronda de jefe, que se pone verde al vencerlo. La destrucción de la página ya no es un objetivo ni termina la partida. Solo hay dos finales: vencer al jefe de la ronda 20 (la página se derrumba como celebración y aparece «¡CAMPEÓN!») o perder los 3 corazones («¡TE DERROTARON!»). En ambos puedes jugar otra vez o cambiar de URL.

## Restricciones reales de los navegadores

Comprobadas al construir el juego, no supuestas:

1. **Un iframe de otro origen nunca expone su DOM.** La política del mismo origen impide que el juego lea o modifique los elementos de una web ajena, aunque se muestre en un iframe. Por eso la destrucción de elementos reales solo es posible en páginas propias, servidas desde el mismo origen que el juego.
2. **Muchas webs prohíben mostrarse dentro de otra** con `X-Frame-Options: DENY/SAMEORIGIN` o `Content-Security-Policy: frame-ancestors`. Según las pruebas: GitHub (`frame-ancestors 'none'`), Hacker News (`frame-ancestors 'self'`), Google (`X-Frame-Options: SAMEORIGIN`) y MDN (`X-Frame-Options: DENY`). El juego respeta esas cabeceras y no intenta saltárselas.
3. **El navegador no informa de por qué falla un iframe de otro origen**: el evento `load` se dispara incluso con la página de error. Por eso la compatibilidad se comprueba antes, leyendo las cabeceras desde el servidor local.
4. **Un iframe en sandbox sin `allow-scripts` no ejecuta JavaScript** (algunas páginas pierden contenido dinámico). Es una decisión deliberada para no ejecutar código de terceros.

## Arquitectura

Vite + TypeScript sin framework, el mismo stack que `../hotshot-destroy`, del que se adaptaron el extractor de piezas y el sintetizador de audio. El plugin de API es un middleware de Vite y no hay más servicios.

```
URL ──► core/url (validación) ──► compat.ts ──┬─ mismo origen ─────────────► stage/dom.ts      (B · DOM real)
                                              ├─ /api/probe: frame OK ─────► stage/iframe.ts   (A · iframe + capa de daño)
                                              ├─ /api/capture (Chromium) ──► stage/capture.ts  (C · simulación visual)
                                              └─ nada posible ─────────────► pantalla de motivo + alternativa (D)

game.ts (bucle) ── core/weapon (munición/recarga) ── core/score (puntos/dificultad) ── core/damage (vida, grietas, fragmentos)
     └─ fx/particles (física)  fx/ducks (objetivos)  fx/gun (arma, mira)  audio.ts  ui.ts + main.ts (HUD y pantallas)  settings.ts
```

| Responsabilidad | Archivo |
| --- | --- |
| Gestión y validación de URL | `src/core/url.ts` (compartido con el servidor), `server/net.ts` (SSRF) |
| Compatibilidad y errores | `src/compat.ts`, `src/core/frame.ts`, `server/probe.ts` |
| Visualización del escenario | `src/stage/{dom,iframe,capture}.ts` con una interfaz común en `src/stage/types.ts` |
| Apuntado y disparo | `src/game.ts` (`fire`), `src/fx/gun.ts` |
| Munición y recarga | `src/core/weapon.ts` (máquina de estados pura) y `src/game.ts` (`reload`, `shockwave`) |
| Sistema de daño | `src/core/damage.ts` y cada stage |
| Física y partículas | `src/fx/particles.ts` |
| Puntuación y progresión | `src/core/score.ts`, `src/fx/ducks.ts` |
| Audio | `src/audio.ts` |
| Interfaz y configuración | `index.html`, `src/ui.ts`, `src/main.ts`, `src/settings.ts`, `src/style.css` |
| Captura en servidor | `server/capture.ts`, `server/extract.js`, `server/plugin.ts` |

### Los modos

**B · DOM real** (`stage/dom.ts`). Para páginas del mismo origen, como la página de prueba `demo/index.html` (`/demo/`). El juego tiene acceso al DOM: `elementFromPoint` localiza el elemento alcanzado y se le aplican atributos y variables CSS con filtros (tinte), `transform` (rotación y sesgo), una sacudida con la Web Animations API y, al romperse, una caída con transición antes de quedar `visibility: hidden`. Las marcas de impacto y las grietas se anclan al elemento (posición relativa a su caja), así que siguen al desplazamiento, al contenido dinámico y a los cambios de tamaño. Un `MutationObserver` incorpora los elementos que aparecen después. Los cambios solo existen en esa pestaña.

**A · Iframe en vivo** (`stage/iframe.ts`). Para páginas externas cuyas cabeceras permiten mostrarse en un iframe. El iframe usa `sandbox=""` (sin scripts, formularios, popups ni navegación), `credentialless` (sin cookies ni sesión) y `referrerpolicy="no-referrer"`. Como el DOM es inaccesible, el daño se dibuja en una capa superpuesta dividida en celdas que se agrietan, se oscurecen y acaban rasgándose. El desplazamiento está bloqueado: la capa está fijada a la vista y no se puede sincronizar con el scroll de un documento ajeno.

**C · Simulación visual** (`stage/capture.ts`). El servidor local abre la página en un contexto nuevo de Chromium headless, sin cookies ni sesión y con service workers bloqueados. Hace dos capturas, la página tal cual y la página sin contenido, hasta 5000 px de alto, y obtiene los rectángulos de textos, imágenes, controles y cajas pintadas. Cada pieza se recorta de la captura y se puede agrietar, deformar, fragmentar y hacer caer. Las cajas abren agujeros en el fondo. El HUD lo identifica como **SIMULACIÓN VISUAL** y la pantalla final indica que la página real no se ha modificado.

**D · No compatible**. Si la URL es inválida, privada, no es HTML, responde con un error o no se puede cargar ni capturar, se explica el motivo y se ofrece la página de prueba. Nunca se queda una pantalla en blanco.

El modo recomendado para páginas externas es la simulación visual, porque permite destruir elemento a elemento. Si el iframe está permitido, también se puede elegir.

## Seguridad y privacidad

- Solo se aceptan `http:` y `https:`. Se rechazan `javascript:`, `data:`, `file:`, `ftp:`, `blob:`, `about:` y similares, URLs con espacios o caracteres de control (trucos de ofuscación) y URLs con usuario o contraseña.
- **Protección SSRF** (`server/net.ts`): el servidor solo visita hosts que resuelven a IPs públicas. Bloquea loopback, redes privadas, link-local (incluido `169.254.169.254`), CGNAT, multicast, ULA/IPv6 local e IPv4 mapeado. La comprobación se repite en cada redirección y en **cada petición** que hace la página capturada (`context.route`).
- No se envían cookies ni credenciales, y no se reutilizan sesiones. Cada captura usa un contexto nuevo y desechable, y el iframe es `credentialless`.
- No se ejecuta código de la página en el juego: el iframe externo no tiene scripts y del servidor solo llegan imágenes y rectángulos en JSON. Los textos de cabeceras ajenas se insertan con `textContent`.
- Las capturas se procesan en tu propio equipo y la URL no se envía a servicios de terceros. La pantalla inicial lo explica, y pulsar CARGAR equivale a aceptar esa visita.
- No se elude ninguna protección de terceros. No hay proxy que reescriba páginas ni elimine `X-Frame-Options` o CSP. Si una web prohíbe el iframe, el juego no lo usa.

Límite conocido: existe una ventana teórica de *DNS rebinding* entre la comprobación y la conexión de `fetch` en `/api/probe`. La API está pensada para un servidor de desarrollo local, no para exponerse públicamente.

## Compatibilidad comprobada

Resultados reales (15 de octubre de 2026) con `/api/probe` y el e2e:

| URL / tipo | Iframe | Simulación visual | DOM real | Notas |
| --- | --- | --- | --- | --- |
| `/demo/` (página propia) | — | — | ✅ | Destrucción real de elementos, scroll y contenido dinámico |
| `https://example.com` | ✅ | ✅ | ❌ otro origen | En la captura casi todo es fondo |
| `https://en.wikipedia.org/wiki/Duck_Hunt` | ✅ | ✅ (395 piezas, ~6 s) | ❌ | |
| `https://eddyverso.com` → `www.eddyverso.com` | ✅ | ✅ (~85 piezas, 2977 px, ~20 s) | ❌ | Tiene recursos que nunca terminan de cargar: se captura en cuanto el documento está listo |
| `https://github.com` | ❌ `frame-ancestors 'none'` | ✅ (173 piezas, ~10 s) | ❌ | Su hero es `position: fixed`: se conserva en la captura |
| `https://news.ycombinator.com` | ❌ `frame-ancestors 'self'` | ✅ (361 piezas, ~4-10 s) | ❌ | |
| `https://developer.mozilla.org/en-US/` | ❌ `X-Frame-Options: DENY` | ✅ (353 piezas, ~5 s) | ❌ | |
| `https://www.google.com` | ❌ `X-Frame-Options: SAMEORIGIN` | ✅ (26 piezas, ~5 s) | ❌ | Página muy sencilla: poca cosa que romper |
| Imagen / PDF / recurso no HTML | ❌ | ❌ | ❌ | Modo D con explicación |
| `localhost`, IPs privadas, metadatos cloud | ❌ | ❌ | ❌ | Bloqueado por diseño (SSRF) |
| Dominio inexistente | ❌ | ❌ | ❌ | «No se encuentra el dominio…» |

En general, las páginas públicas y estáticas (blogs, documentación, Wikipedia) funcionan bien en ambos modos externos. Las webs de grandes plataformas suelen prohibir el iframe pero se pueden capturar. **No son compatibles**: páginas tras inicio de sesión (la captura no tiene sesión y mostrará la pantalla de login), webs que bloquean navegadores automatizados o muestran un CAPTCHA (se capturará el CAPTCHA o fallará con su código HTTP) y contenido que solo aparece tras interactuar.

## Pruebas y resultados

### Unitarias — `npm test`

53 pruebas, todas superadas: validación de URL (esquemas, protocolo ausente, credenciales, caracteres de control), veredicto de iframe (XFO y `frame-ancestors`), máquina de estados del arma (cadencia, munición, recarga, recarga perfecta, encasquillado y armas bonus que no recargan y se agotan), bandada bonus, jefes (rondas, blindaje del Mecha-Pato, huevos que llegan al suelo, señuelos, heridas y furia), bloques pixel, mordiscos en los bordes, patos aliados (prioridad a proyectiles, blindaje, límite y retirada) rondas que vuelven a avanzar tras perder contra un jefe, una sola ronda de avance al vencer a un jefe aunque haya una oleada en curso, y el cálculo del avance hacia la ronda 20, puntuación y dificultad, modelo de daño y guardia SSRF.

### Extremo a extremo — `npm run test:e2e`

Chromium real con eventos reales de ratón y teclado. Última ejecución: **19 de 19 comprobaciones superadas**. Las capturas quedan en `tests/e2e/out/`.

| # | Caso | Resultado observado |
| --- | --- | --- |
| 1 | Página propia, DOM real | Modo recomendado `dom`. El `<h1>` real acaba con `visibility: hidden` tras romperse |
| 1b | Scroll y contenido dinámico | `scrollY` 0→500 con la rueda. Un elemento añadido por script después de cargar recibe daño |
| 2 | Externa con iframe permitido (example.com) | Iframe con `sandbox=""` y `credentialless`. `contentDocument === null` (DOM inaccesible). Hay daño en la capa |
| 3 | Externa que bloquea iframe (github.com) | Iframe no disponible por `frame-ancestors 'none'`; recomienda la simulación visual, se rompen piezas |
| 4 | URL inválida | `no es una url`, `https://`, `holamundo` y un dominio inexistente se rechazan con mensaje |
| 5 | URL sin protocolo | `example.com` pasa a `https://example.com/` con aviso |
| 6 | Esquemas no permitidos y red privada | `javascript:`, `data:`, `file:`, `ftp:`, `127.0.0.1`, `169.254.169.254` y `user:pass@` se rechazan |
| D | Recurso no HTML | Ningún modo disponible: se explica y se ofrece la página de prueba |
| 7 | Disparos repetidos al mismo elemento | Estados `2 → 2 → 3 → 3 → roto` con escopeta |
| 8 | Recarga en distintos estados | Con cargador lleno se rechaza. A media carga bloquea el disparo y no causa daño (destrucción 0,0 %→0,0 %). Una pulsación fuera de la zona se encasquilla. Con cargador vacío recarga sin dañar y devuelve la munición. En pausa se ignora |
| B | Armas bonus | Al disparar a una caja en paracaídas, esta cae y da el lanzacohetes al aterrizar. Un cohete directo a un pato abate también al de al lado (2 patos) y daña la página. Al vaciarse vuelve la escopeta. Una caja de corazón con 2 corazones deja 3. La ametralladora hace 12 disparos manteniendo el clic 1 s. R no recarga un arma bonus |
| J | Jefe y corazones | En la ronda 5 aparece Mamá Pato con 2 corazones en el HUD. Tras vencerla, el avance marca 25 % y la primera marca de jefe se pone verde. Se dispara a una caja A y aparece un aliado, que en 3 s hace 5 disparos y acierta los 5; se retira al caer el jefe. Cae con 5 cohetes; un huevo que llegó al suelo quitó un corazón y vencerla devolvió uno (1→2). Se pasa a la ronda 6 con 2 cajas de recompensa. Tres golpes llevan a «¡TE DERROTARON!», y «Jugar otra vez» reinicia corazones y ronda |
| 9c | Victoria tras la ronda 20 | Al vencer al jefe de la ronda 20, la página se derrumba, aparece «¡CAMPEÓN! LAS 20 RONDAS SUPERADAS» y el avance marca 100 % |
| 9 / 9a / 9b | Reinicio, cambio de escenario y partida completa | Un bot que dispara en rejilla, sin derribar huevos, llega a la ronda 5 y Mamá Pato lo derrota («¡TE DERROTARON!», unos 130 disparos). «Jugar otra vez» y «Reiniciar» ponen el estado a cero. «Cambiar URL» libera el escenario |
| 10 | Tamaños de pantalla | 1920×1080, 1280×720, 768×1024 y 390×844: sin scroll horizontal, HUD dentro de la pantalla y disparos efectivos |
| FPS | Rendimiento | 60 fps medidos durante la caída de escombros (headless) |
| JS | Errores de consola | Ninguno inesperado. Los esperados son las respuestas 400 de URLs rechazadas y el script de example.com bloqueado por el sandbox |

Las pruebas encontraron y permitieron corregir varios fallos reales:

- La página de prueba en `public/` caía en el fallback SPA y cargaba el propio juego dentro del iframe.
- El extractor heredado descartaba imágenes y controles al reintentar.
- Los contenedores pintados no contaban en el medidor.
- Una caja del tamaño de una sección dejaba el escenario vacío de golpe.
- Al anular las animaciones, el contenido que aparece con un fundido se capturaba invisible. Ahora las animaciones saltan a su estado final.
- La heurística heredada borraba como si fuera un overlay cualquier elemento fijo grande, incluido el hero de GitHub. Ahora solo se eliminan diálogos y banners identificados como tales.

### Limitaciones conocidas

- La primera captura de una página tarda entre 5 y 20 s, según el sitio. Luego queda en caché en el servidor y en el cliente.
- En la simulación visual solo se capturan los primeros 5000 px de la página. Las páginas largas tardan algo más en capturarse.
- En el modo iframe no hay desplazamiento: el navegador no permite saber cuánto se ha desplazado una página de otro origen, así que los daños quedarían desalineados. La pantalla de compatibilidad lo indica. Además, si la ventana cambia de tamaño, la capa de daño se estira mientras la página se recoloca.
- No se probó en Firefox ni Safari. El atributo `credentialless` solo lo aplica Chromium; los demás lo ignoran, aunque el sandbox sin scripts sigue aislando la página.
