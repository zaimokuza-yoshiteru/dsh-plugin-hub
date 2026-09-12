import React from 'react';
import { ResourceHub, HubSidebarButton } from './resources.jsx';
import { resourceWords, translate } from './locale.js';
import { connectionRequest } from './api.js';
const NS = __HUB_PACKAGE__;
const MARKET_ID = __HUB_ID__;
const BRAND = __HUB_BRAND__;

export const name = NS;
export const inject = ['slots', 'locale', 'layout', 'connection'];
export function apply(ctx) {
  const words = { zh: Object.fromEntries(Object.keys(resourceWords).map(key => [key, key])), en: resourceWords };
  ctx.effect(() => ctx.locale.register(NS, words), 'Plugin Hub: dictionaries');
  const t = translate(ctx.locale.bind(NS));
  const request = connectionRequest(ctx.connection, MARKET_ID);
  const panelId = 'plugin-hub-' + MARKET_ID;
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId, locale: NS }, () => <ResourceHub ctx={ctx} request={request} t={t} brand={BRAND} panelId={panelId}/>));
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({ name: 'sidebar.footer.action', id: panelId, order: 39, locale: NS }, props => <HubSidebarButton {...props} ctx={ctx} panelId={panelId} brand={BRAND}/>));
}
