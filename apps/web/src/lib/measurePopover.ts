/**
 * Build 0099: whether the host's native Measure popover is open AND ATTACHED (the host says so with the ui commands `measure.popoverOpened`, `measure.popoverDetached` (Build 0105: false from then on; the detached palette stays open and Escape is the editor's again) and `measure.popoverClosed`). One page runs one document, so
 * this is one flag. While it is open the page's Escape follows the agreed hierarchy: a measuring OPERATION that is active is cancelled by the tool's own handler (the key is consumed and the
 * popover stays); with none active the page does nothing with the key (it does NOT clear the selection) and leaves it unhandled, so AppKit hands it up the responder chain and the host
 * dismisses the popover. With the popover closed Escape keeps its existing editor behaviour.
 */
let open = false;

export function setMeasurePopoverOpen(next: boolean) {
  open = next;
}

export function isMeasurePopoverOpen(): boolean {
  return open;
}
