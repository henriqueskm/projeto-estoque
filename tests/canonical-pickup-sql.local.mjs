// Adapt historical local regression calls to the checked API used by the app.
// Never re-grant the obsolete unchecked public wrappers in a current schema.
export function checkedPickupSql(statement) {
  return statement.replace(/public\.set_supplier_order_item_picked_quantity\('([^']+)',\s*(\d+),\s*null,\s*'([^']+)'\)/g,
    (_, line, quantity, key) => `public.set_supplier_order_item_picked_quantity_checked('${line}',${quantity},null,(select o.updated_at from public.supplier_orders o join public.supplier_order_items i on i.supplier_order_id=o.id where i.id='${line}'),'${key}')`)
    .replace(/public\.mark_supplier_order_all_picked\('([^']+)',\s*null,\s*'([^']+)'\)/g,
      (_, order, key) => `public.mark_supplier_order_all_picked_checked('${order}',null,(select updated_at from public.supplier_orders where id='${order}'),'${key}')`)
    .replace(/public\.(cancel_supplier_order(?:_remaining)?)\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g,
      (_, name, order, reason, key) => `public.${name}_checked('${order}','${reason}',(select updated_at from public.supplier_orders where id='${order}'),'${key}')`);
}
