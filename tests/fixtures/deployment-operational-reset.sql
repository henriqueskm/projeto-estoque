\set ON_ERROR_STOP on

begin;

do $$
declare
  operational_rows bigint;
begin
  select
    (select count(*) from public.stock_movements)
    + (select count(*) from public.configuration_stock_movements)
    + (select count(*) from public.movement_batches)
    + (select count(*) from public.supplier_orders)
    + (select count(*) from public.safisa_portal_events)
    + (select count(*) from public.push_notification_events)
  into operational_rows;

  if operational_rows <> 0 then
    raise exception 'Disposable fixture requires an operationally empty clone.';
  end if;
end;
$$;

delete from public.push_subscriptions;
update public.items set minimum_stock = 0 where minimum_stock <> 0;
update public.commercial_configurations set minimum_stock = 0 where minimum_stock <> 0;

update public.items
set minimum_stock = 4
where code = '1';

update public.commercial_configurations
set minimum_stock = 3
where id = '205f8975-c6fd-4589-ac8d-090409f1872d';

insert into public.minimum_stock_changes (
  id, item_id, previous_minimum_stock, new_minimum_stock, user_id, user_name_snapshot
) values (
  '20000000-0000-0000-0000-000000000001',
  'd9bfc725-87a3-4194-8f51-bdc49d95bd8c',
  0,
  4,
  '10000000-0000-0000-0000-000000000001',
  'Reset Test Internal'
);

insert into public.configuration_minimum_stock_changes (
  id, configuration_id, previous_minimum_stock, new_minimum_stock, user_id, user_name_snapshot
) values (
  '20000000-0000-0000-0000-000000000002',
  '205f8975-c6fd-4589-ac8d-090409f1872d',
  0,
  3,
  '10000000-0000-0000-0000-000000000001',
  'Reset Test Internal'
);

insert into public.stock_balances (item_id, quantity)
values ('d9bfc725-87a3-4194-8f51-bdc49d95bd8c', 8);

insert into public.configuration_stock_balances (configuration_id, quantity)
values ('205f8975-c6fd-4589-ac8d-090409f1872d', 2);

insert into public.movement_batches (
  id, movement_type, source, user_id, user_name_snapshot, description, reversed_batch_id
) values
  ('30000000-0000-0000-0000-000000000001', 'INBOUND', 'MANUAL', '10000000-0000-0000-0000-000000000001', 'Reset Test Internal', 'Fixture inbound', null),
  ('30000000-0000-0000-0000-000000000002', 'OUTBOUND', 'MANUAL', '10000000-0000-0000-0000-000000000001', 'Reset Test Internal', 'Fixture outbound', null),
  ('30000000-0000-0000-0000-000000000003', 'ASSEMBLY', 'MANUAL', '10000000-0000-0000-0000-000000000001', 'Reset Test Internal', 'Fixture assembly', null),
  ('30000000-0000-0000-0000-000000000004', 'DISASSEMBLY', 'MANUAL', '10000000-0000-0000-0000-000000000001', 'Reset Test Internal', 'Fixture disassembly', null),
  ('30000000-0000-0000-0000-000000000005', 'REVERSAL', 'MANUAL', '10000000-0000-0000-0000-000000000001', 'Reset Test Internal', 'Fixture reversal', '30000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000006', 'INBOUND', 'MANUAL', '10000000-0000-0000-0000-000000000001', 'Reset Test Internal', 'Fixture supplier entry', null);

insert into public.stock_movements (
  id, batch_id, item_id, quantity_change, quantity_before, quantity_after
) values
  ('31000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', 10, 0, 10),
  ('31000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', -2, 10, 8),
  ('31000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000003', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', -1, 8, 7),
  ('31000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000004', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', 1, 7, 8),
  ('31000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000005', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', 2, 8, 10),
  ('31000000-0000-0000-0000-000000000006', '30000000-0000-0000-0000-000000000006', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', 1, 10, 11);

insert into public.configuration_stock_movements (
  id, batch_id, configuration_id, quantity_change, quantity_before, quantity_after
) values
  ('32000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '205f8975-c6fd-4589-ac8d-090409f1872d', 1, 1, 2),
  ('32000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', '205f8975-c6fd-4589-ac8d-090409f1872d', -1, 2, 1);

insert into public.inbound_batch_lines (id, batch_id, item_id, quantity)
values
  ('33000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', 10),
  ('33000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000006', 'd9bfc725-87a3-4194-8f51-bdc49d95bd8c', 1);

insert into public.outbound_batch_lines (
  id, batch_id, item_id, quantity, assembled_quantity_used, auto_assembled_quantity
) values (
  '34000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000002',
  'd9bfc725-87a3-4194-8f51-bdc49d95bd8c',
  2,
  0,
  0
);

insert into public.assembly_operations (
  id, batch_id, configuration_id, operation_type, quantity,
  commercial_configuration_code_id, commercial_code_snapshot
) values
  ('35000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', '205f8975-c6fd-4589-ac8d-090409f1872d', 'ASSEMBLY', 1, '2d47a8b8-b311-4d27-b559-da3530013d9f', '10A'),
  ('35000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000004', '205f8975-c6fd-4589-ac8d-090409f1872d', 'DISASSEMBLY', 1, '2d47a8b8-b311-4d27-b559-da3530013d9f', '10A');

insert into private.stock_adjustment_requests (
  id, user_id, user_name_snapshot, idempotency_key, target_type,
  item_id, counted_quantity, reason
) values (
  '36000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Reset Test Internal',
  '36000000-0000-0000-0000-000000000002',
  'ITEM',
  'd9bfc725-87a3-4194-8f51-bdc49d95bd8c',
  8,
  'Fixture pending adjustment'
);

insert into private.configuration_operation_requests (
  id, user_id, user_name_snapshot, idempotency_key, operation_type,
  configuration_id, commercial_configuration_code_id, commercial_code_snapshot,
  quantity, description
) values (
  '37000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  'Reset Test Internal',
  '37000000-0000-0000-0000-000000000002',
  'ASSEMBLY',
  '205f8975-c6fd-4589-ac8d-090409f1872d',
  '2d47a8b8-b311-4d27-b559-da3530013d9f',
  '10A',
  1,
  'Fixture pending configuration operation'
);

insert into public.supplier_orders (
  id, negotiation_number, order_date, notes, created_by, created_by_name_snapshot
) values (
  '40000000-0000-0000-0000-000000000001',
  '999000001',
  current_date,
  'Disposable reset fixture',
  '10000000-0000-0000-0000-000000000001',
  'Reset Test Internal'
);

insert into public.supplier_order_items (
  id, supplier_order_id, item_id, code_snapshot, description_snapshot,
  item_type_snapshot, ordered_quantity, ready_quantity, picked_quantity,
  stocked_quantity, cancelled_quantity, position
) values (
  '41000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'd9bfc725-87a3-4194-8f51-bdc49d95bd8c',
  '1',
  'SERVO MBF-015',
  'SERVO',
  5,
  3,
  2,
  1,
  0,
  0
);

insert into public.safisa_order_authorizations (
  supplier_order_id, is_authorized, published_by, published_by_name_snapshot
) values (
  '40000000-0000-0000-0000-000000000001',
  true,
  '10000000-0000-0000-0000-000000000001',
  'Reset Test Internal'
);

insert into public.supplier_order_events (
  id, supplier_order_id, supplier_order_item_id, event_type, user_id,
  user_name_snapshot, idempotency_key, description, details
) values (
  '42000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  null,
  'STOCK_ENTRY_CREATED',
  '10000000-0000-0000-0000-000000000001',
  'Reset Test Internal',
  '42000000-0000-0000-0000-000000000002',
  'Fixture stock entry',
  '{}'::jsonb
);

insert into public.supplier_order_stock_entries (
  id, supplier_order_id, movement_batch_id, note, created_by, created_by_name_snapshot
) values (
  '43000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000006',
  'Fixture linked inbound',
  '10000000-0000-0000-0000-000000000001',
  'Reset Test Internal'
);

insert into public.supplier_order_stock_entry_lines (
  id, supplier_order_stock_entry_id, supplier_order_item_id,
  inbound_batch_line_id, quantity, item_id
) values (
  '44000000-0000-0000-0000-000000000001',
  '43000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  '33000000-0000-0000-0000-000000000002',
  1,
  'd9bfc725-87a3-4194-8f51-bdc49d95bd8c'
);

insert into public.safisa_portal_events (
  id, event_type, actor_user_id, actor_name_snapshot, actor_kind,
  supplier_order_id, supplier_order_item_id, idempotency_key,
  previous_quantity, quantity_delta, new_quantity,
  request_payload, result_payload
) values (
  '45000000-0000-0000-0000-000000000001',
  'READY_QUANTITY_INCREMENTED',
  '10000000-0000-0000-0000-000000000002',
  'Reset Test Safisa',
  'SAFISA',
  '40000000-0000-0000-0000-000000000001',
  '41000000-0000-0000-0000-000000000001',
  '45000000-0000-0000-0000-000000000002',
  0,
  3,
  3,
  '{}'::jsonb,
  '{}'::jsonb
);

insert into public.push_notification_events (
  id, event_type, supplier_order_id, negotiation_number, status
) values (
  '46000000-0000-0000-0000-000000000001',
  'SAFISA_FULLY_READY',
  '40000000-0000-0000-0000-000000000001',
  '999000001',
  'PENDING'
);

insert into public.push_subscriptions (
  id, user_id, device_id, firebase_installation_id, enabled
) values
  ('47000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '47000000-0000-0000-0000-000000000011', 'fixture-installation-internal', true),
  ('47000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000003', '47000000-0000-0000-0000-000000000012', 'fixture-installation-observer', true);

commit;
