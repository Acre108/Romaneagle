import type { CompanionDefinition } from "../scenario/Roster";

const PORTRAIT_FOLDER = "portraits";
const PORTRAIT_IMAGE_CLASS = "character-portrait-image";
const PORTRAIT_READY_CLASS = "has-character-portrait";

export function portraitAssetPath(
  companionId: string,
  baseUrl = "/",
): string {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${PORTRAIT_FOLDER}/${encodeURIComponent(companionId)}.png`;
}

export function applyCompanionPortrait(
  container: HTMLElement,
  companion: Pick<CompanionDefinition, "id" | "name">,
  baseUrl = import.meta.env.BASE_URL,
): void {
  let image = container.querySelector<HTMLImageElement>(`.${PORTRAIT_IMAGE_CLASS}`);
  if (!image) {
    image = document.createElement("img");
    image.className = PORTRAIT_IMAGE_CLASS;
    image.alt = "";
    image.decoding = "async";
    image.setAttribute("aria-hidden", "true");
    container.append(image);
  }

  const source = portraitAssetPath(companion.id, baseUrl);
  container.classList.remove(PORTRAIT_READY_CLASS);
  container.dataset.portraitFor = companion.id;
  image.onload = () => {
    if (container.dataset.portraitFor === companion.id) {
      container.classList.add(PORTRAIT_READY_CLASS);
    }
  };
  image.onerror = () => {
    if (container.dataset.portraitFor === companion.id) {
      container.classList.remove(PORTRAIT_READY_CLASS);
    }
  };

  if (image.getAttribute("src") !== source) {
    image.src = source;
  } else if (image.complete && image.naturalWidth > 0) {
    container.classList.add(PORTRAIT_READY_CLASS);
  }
  image.title = companion.name;
}

