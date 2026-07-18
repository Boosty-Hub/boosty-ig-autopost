# boosty-ig-autopost

Auto-publicación de los carruseles de Boosty en Instagram **@boosty.digital**, en la nube — **sin depender de ninguna máquina ni de la app de Claude abierta**.

## Cómo funciona
- **GitHub Actions** (cron `0 11 * * *` = **07:00 hora Venezuela**) corre a diario.
- `publish.mjs` mira `schedule.json`: si hoy (fecha VET) hay un post, lo publica vía **API Graph de Instagram**.
- La media (jpg + mp4) se sirve por **GitHub Pages** (`https://boosty-hub.github.io/boosty-ig-autopost/media/...`), que es el hosting público que Instagram exige.
- El token vive en **Repository Secret** `META_ACCESS_TOKEN` (system-user, no caduca). Nunca está en el código.
- Dedup incluido: no republica si ya salió un post con el mismo inicio de caption.

## Estructura
- `media/<slug>/01..05.jpg` + `video.mp4` — las piezas de cada carrusel.
- `captions/caption_*.txt` — los textos.
- `schedule.json` — calendario `fecha VET → {slug, videoFirst, caption}`.
- `publish.mjs` — publicador (Graph API, sin dependencias).
- `.github/workflows/publish.yml` — el cron + disparo manual.

## Probar / operar
- **Prueba sin publicar:** Actions → *Publicar carrusel en Instagram* → **Run workflow** → `dry_run = true`. Valida que las URLs de Pages sirvan y que no haya duplicado.
- **Publicar uno ahora:** Run workflow con `dry_run = false` y opcional `force_slug = c8-dashboards`.
- **Cambiar el calendario:** edita `schedule.json`.
- **Agregar un carrusel nuevo:** sube `media/<slug>/…` + `captions/…` y añádelo a `schedule.json`.

## Requisitos (ya configurados)
- Secret `META_ACCESS_TOKEN` con permiso `instagram_content_publish` sobre la cuenta `17841421294200897`.
- GitHub Pages activado (rama `main`, raíz).

Generado desde el proyecto **Creador de Post** (Boosty). Los creativos se producen con el studio de render por código (ver repo `Claude-Sessions-Gabriel/Creador-de-Post`).
