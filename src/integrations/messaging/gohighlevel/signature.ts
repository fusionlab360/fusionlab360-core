const GHL_PUBLIC_KEY_PEM =
  `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=
-----END PUBLIC KEY-----`;


function pemToArrayBuffer(
  pem: string,
): ArrayBuffer {

  const base64 =
    pem
      .replace(
        "-----BEGIN PUBLIC KEY-----",
        "",
      )
      .replace(
        "-----END PUBLIC KEY-----",
        "",
      )
      .replace(
        /\s+/g,
        "",
      );

  const binary =
    atob(base64);

  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let index = 0;
    index < binary.length;
    index++
  ) {
    bytes[index] =
      binary.charCodeAt(index);
  }

  return bytes.buffer;
}


function base64ToBytes(
  value: string,
): Uint8Array {

  const normalized =
    value
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const padded =
    normalized.padEnd(
      Math.ceil(
        normalized.length / 4,
      ) * 4,
      "=",
    );

  const binary =
    atob(padded);

  const bytes =
    new Uint8Array(
      binary.length,
    );

  for (
    let index = 0;
    index < binary.length;
    index++
  ) {
    bytes[index] =
      binary.charCodeAt(index);
  }

  return bytes;
}


export async function verifyGHLSignature(
  body: string,
  signature:
    string | undefined,
): Promise<boolean> {

  if (
    !signature ||
    signature === "N/A"
  ) {
    return false;
  }

  try {

    const publicKey =
      await crypto.subtle.importKey(
        "spki",
        pemToArrayBuffer(
          GHL_PUBLIC_KEY_PEM,
        ),
        {
          name:
            "Ed25519",
        },
        false,
        ["verify"],
      );

    return await crypto.subtle.verify(
      {
        name:
          "Ed25519",
      },
      publicKey,
      base64ToBytes(
        signature,
      ),
      new TextEncoder().encode(
        body,
      ),
    );

  } catch {

    return false;
  }
}