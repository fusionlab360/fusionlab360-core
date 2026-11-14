import assert from "node:assert/strict";
import test from "node:test";
import { decodeUtf8Body, readBoundedBody, RequestBodyTooLargeError } from "../../../src/core/http/bounded-body";

test("bounded request reader preserves exact bytes at the boundary", async () => {
  const body = new Uint8Array([0, 255, 10, 13]);
  const request = new Request("https://example.test/hook", { method: "POST", body });
  assert.deepEqual(await readBoundedBody(request, body.byteLength), body);
});

test("bounded request reader rejects declared and streamed oversized bodies", async () => {
  const declared = new Request("https://example.test/hook", {
    method: "POST",
    headers: { "content-length": "5" },
    body: "12345",
  });
  await assert.rejects(() => readBoundedBody(declared, 4), RequestBodyTooLargeError);

  const streamed = new Request("https://example.test/hook", {
    method: "POST",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4, 5]));
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(() => readBoundedBody(streamed, 4), RequestBodyTooLargeError);
});

test("bounded request reader rejects malformed lengths and invalid UTF-8", async () => {
  const malformedLength = new Request("https://example.test/hook", {
    method: "POST",
    headers: { "content-length": "1.5" },
    body: "x",
  });
  await assert.rejects(() => readBoundedBody(malformedLength, 4), TypeError);
  assert.throws(() => decodeUtf8Body(new Uint8Array([0xff])), TypeError);
});
