#! /usr/bin/env node

import { Command, program } from "@commander-js/extra-typings"
import commands from "./commands/index"
import * as A from "fp-ts/Array"

A.map((cmd: Command) => program.addCommand(cmd))(commands)
;(async () => {
  program.parseAsync()
})()
