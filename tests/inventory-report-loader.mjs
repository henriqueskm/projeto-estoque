import { resolve as bundleResolve, load as bundleLoad } from "./bundle-inventory-loader.mjs";
export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith("report.module.css")) return { url: "data:text/javascript,export default {workspace:'workspace',category:'category',code:'code',table:'table',mobileRows:'mobileRows',printReport:'printReport',overlay:'overlay',sheet:'sheet'}", shortCircuit: true };
  if (specifier === "@/lib/auth") return { url: "data:text/javascript,export async function requireActiveProfile(){if(!globalThis.__NK86_ACTIVE__)throw new Error('unauthorized');return {id:'86000000-0000-4000-8000-000000000001'}}", shortCircuit: true };
  if (specifier === "next/link") return { url: "data:text/javascript,import {createElement} from 'react';export default function Link({children,prefetch,...props}){return createElement('a',props,children)}", shortCircuit: true };
  return bundleResolve(specifier, context, nextResolve);
}
export const load = bundleLoad;
