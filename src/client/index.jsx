import React from 'react';
import { ResourceHub } from './resources.jsx';
import { HubHeaderEntry, HubEmptyEntry } from './entry.jsx';
import { resourceWords, translate } from './locale.js';
import { connectionRequest } from './api.js';
import { experimentClient } from './experiments.js';
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
  const experiments = experimentClient(request, window.dshDesktop, () => window.location.reload());
  const panelId = 'plugin-hub-' + MARKET_ID;
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: panelId, locale: NS }, () => <ResourceHub ctx={ctx} request={request} experiments={experiments} t={t} brand={BRAND} panelId={panelId}/>));
  ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({ name: 'conversation.session.header.utilities', id: panelId, order: 100, locale: NS }, () => <HubHeaderEntry ctx={ctx} panelId={panelId} brand={BRAND}/>));
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: panelId, locale: NS }, props => <HubEmptyEntry {...props} ctx={ctx} panelId={panelId} brand={BRAND}/>));
}
