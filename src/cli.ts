#!/usr/bin/env node

import { handleError, runCli } from "./cli-runtime.js";

runCli().catch(handleError);
