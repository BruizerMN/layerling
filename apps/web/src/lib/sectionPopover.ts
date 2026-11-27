/**
 * Build 0103: whether the host's native Section View popover is open AND ATTACHED to its toolbar item (the host says so with the ui commands `section.popoverOpened`, `section.popoverDetached`
 * and `section.popoverClosed`). One page runs one document, so this is one flag. While it is true the page's Escape follows the agreed hierarchy: an armed Section Measure is cancelled by the
 * tool's own handler (the key is consumed and the popover stays); with none armed the page does nothing with the key (it does NOT clear the selection) and leaves it unhandled, so AppKit hands
 * it up the responder chain and the host dismisses the popover. A DETACHED palette is not "attached": Escape then keeps its normal editor behaviour and the palette stays open. Escape never
 * turns the cut off.
 */
let attachedOpen = false;

export function setSectionPopoverOpen(next: boolean) {
  attachedOpen = next;
}

export function isSectionPopoverOpen(): boolean {
  return attachedOpen;
}
