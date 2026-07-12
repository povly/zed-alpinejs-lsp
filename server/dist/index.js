#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const node_1 = require("vscode-languageserver/node");
const server_1 = require("./server");
const connection = (0, node_1.createConnection)(node_1.ProposedFeatures.all);
const server = new server_1.AlpineLanguageServer(connection);
server.start();
//# sourceMappingURL=index.js.map