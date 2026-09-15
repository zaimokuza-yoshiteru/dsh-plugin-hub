import React, { useEffect } from 'react';
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives';

export function ResourceModal(props) {
  // The layout's Escape shortcut otherwise closes the panel underneath the native Modal.
  useEffect(() => {
    if (!props.open) return;
    const escape = event => {
      if (event.key !== 'Escape' || event.isComposing) return;
      event.preventDefault(); event.stopImmediatePropagation(); props.onClose();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [props.open, props.onClose]);
  return <Modal {...props}/>;
}

