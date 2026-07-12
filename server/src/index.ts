#!/usr/bin/env node
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { AlpineLanguageServer } from './server';

const connection = createConnection(ProposedFeatures.all);
const server = new AlpineLanguageServer(connection);
server.start();
