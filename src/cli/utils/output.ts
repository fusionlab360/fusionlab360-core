export function title(text: string) {
  console.log("\n================================");
  console.log(text);
  console.log("================================\n");
}

export function success(text: string) {
  console.log(`✅ ${text}`);
}

export function info(text: string) {
  console.log(`ℹ️  ${text}`);
}

export function error(text: string) {
  console.log(`❌ ${text}`);
}