import assert from "node:assert/strict";
import { test } from "node:test";
import { githubRef, linearServer, ownerKind } from "./github.ts";

test("owner routing by origin", () => {
	assert.equal(ownerKind("git@github.com:acme/webapp.git"), "acme");
	assert.equal(ownerKind("git@github.com-work:globex/x.git"), "globex");
	assert.equal(ownerKind("https://github.com/bob/y"), "globex");
	assert.equal(ownerKind("git@github.com:alice/cv.git"), "personal");
	assert.equal(ownerKind(""), "personal");
});

test("token reference and linear only for acme", () => {
	assert.match(githubRef("git@github.com:acme/webapp.git"), /webapp/);
	assert.equal(linearServer("git@github.com:acme/webapp.git"), "linear-acme");
	assert.equal(linearServer("git@github.com:alice/cv.git"), undefined);
});
