create or replace function private.validate_supplier_order_stock_entry_links()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_entry_id uuid;
begin
  if tg_table_name = 'supplier_order_stock_entries' then
    v_entry_id := new.id;
  else
    v_entry_id := new.supplier_order_stock_entry_id;
  end if;

  if not exists (
    select 1
    from public.supplier_order_stock_entries as entry
    join public.movement_batches as batch
      on batch.id = entry.movement_batch_id
    where entry.id = v_entry_id
      and batch.movement_type = 'INBOUND'
      and batch.source = 'MANUAL'
      and batch.user_id is not distinct from entry.created_by
      and batch.user_name_snapshot = entry.created_by_name_snapshot
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock entry must reference its creator''s normal manual inbound batch.';
  end if;

  if exists (
    select 1
    from public.supplier_order_stock_entry_lines as entry_line
    join public.supplier_order_stock_entries as entry
      on entry.id = entry_line.supplier_order_stock_entry_id
    join public.supplier_order_items as order_item
      on order_item.id = entry_line.supplier_order_item_id
    join public.inbound_batch_lines as inbound_line
      on inbound_line.id = entry_line.inbound_batch_line_id
    left join public.commercial_configuration_codes as commercial_code
      on commercial_code.id =
        inbound_line.commercial_configuration_code_id
    where entry_line.supplier_order_stock_entry_id = v_entry_id
      and (
        order_item.supplier_order_id <> entry.supplier_order_id
        or inbound_line.batch_id <> entry.movement_batch_id
        or entry_line.item_id is distinct from order_item.item_id
        or entry_line.commercial_configuration_id
          is distinct from order_item.commercial_configuration_id
        or (
          entry_line.item_id is not null
          and inbound_line.item_id is distinct from entry_line.item_id
        )
        or (
          entry_line.commercial_configuration_id is not null
          and commercial_code.configuration_id
            is distinct from entry_line.commercial_configuration_id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock-entry link does not match its order item or inbound batch line.';
  end if;

  if exists (
    select 1
    from public.inbound_batch_lines as inbound_line
    join public.supplier_order_stock_entries as entry
      on entry.movement_batch_id = inbound_line.batch_id
    left join lateral (
      select coalesce(sum(entry_line.quantity), 0)::bigint as quantity
      from public.supplier_order_stock_entry_lines as entry_line
      where entry_line.supplier_order_stock_entry_id = entry.id
        and entry_line.inbound_batch_line_id = inbound_line.id
    ) as allocated on true
    where entry.id = v_entry_id
      and allocated.quantity <> inbound_line.quantity
  ) then
    raise exception using
      errcode = '23514',
      message = 'Supplier-order stock-entry allocations must equal every consolidated inbound line quantity.';
  end if;

  if not exists (
    select 1
    from public.supplier_order_stock_entry_lines
    where supplier_order_stock_entry_id = v_entry_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'A supplier-order stock entry must contain at least one line.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_supplier_order_stock_entry_links()
from public, anon, authenticated;

comment on function private.validate_supplier_order_stock_entry_links() is
  'Validates deferred order-entry links for either trigger table without resolving fields from the other table row type.';
