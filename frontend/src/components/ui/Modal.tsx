"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function Modal({ open, onOpenChange, title, children, footer }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="lu-modal-overlay" />
        <Dialog.Content className="lu-modal-panel" aria-modal="true">
          <header className="lu-modal-header">
            {title ? <Dialog.Title className="lu-modal-title">{title}</Dialog.Title> : null}
            <Dialog.Close className="lu-modal-close" aria-label="Cerrar">
              ✕
            </Dialog.Close>
          </header>
          <div className="lu-modal-body">{children}</div>
          {footer ? <footer className="lu-modal-footer">{footer}</footer> : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
