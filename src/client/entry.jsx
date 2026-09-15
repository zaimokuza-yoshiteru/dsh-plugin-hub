import React from 'react';
import { Button, Tooltip, IconCordisPluginOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';

const css = `
.hub-entry-button { width: 32px; height: 32px; padding: 0; flex: none; }
.hub-entry-fallback { position: absolute; top: 16px; right: 24px; }
body:has(.hub-header-entry) .hub-entry-fallback { display: none; }
`;

export function HubIconButton({ label, selected = false, onClick }) {
  return <><style>{css}</style><Tooltip label={label} side="bottom"><Button className="hub-entry-button" aria-label={label} aria-pressed={selected} icon={<IconCordisPluginOutline14 size={18}/>} onClick={onClick}/></Tooltip></>;
}

export function HubHeaderEntry({ ctx, panelId, brand }) {
  return <span className="hub-header-entry"><HubIconButton label={brand.navTitle} onClick={() => ctx.layout.selectPanel(panelId)}/></span>;
}

/** Blank conversations have no header. Use the native overlay slot for the
 * same entry there; presence of our header contribution suppresses this seat.
 * No host DOM selectors, relocated nodes or duplicate session-state model.
 */
export function HubEmptyEntry({ usePanelInfo, ctx, panelId, brand }) {
  const conversation = usePanelInfo(info => info.activePanelId === null);
  return conversation ? <div className="hub-entry-fallback"><HubIconButton label={brand.navTitle} onClick={() => ctx.layout.selectPanel(panelId)}/></div> : null;
}
