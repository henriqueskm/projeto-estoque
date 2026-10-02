import type { KeyboardEvent } from "react";

export function dismissSearchKeyboard(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing) return;

  event.preventDefault();
  event.currentTarget.blur();
}
