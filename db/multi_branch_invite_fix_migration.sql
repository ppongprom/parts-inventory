-- ============================================================
-- Card: "Multi-branch support" — follow-up fix
--
-- multi_branch_support_migration.sql replaced shop_members' unique
-- constraint (shop_id, user_id) with (shop_id, user_id, branch_id) so role
-- can differ per branch. That broke every function using
-- `on conflict (shop_id, user_id)` — Postgres errors at runtime ("no unique
-- or exclusion constraint matching the ON CONFLICT specification") because
-- the old 2-column constraint no longer exists:
--   - accept_pending_invites() and accept_pending_invites(text,text)
--   - accept_shop_invite(bigint,text,text)
--   - platform_join_as_support(uuid,bigint)
-- Found by grepping db/*.sql + live pg_proc for every INSERT INTO
-- shop_members ... ON CONFLICT before considering the migration done.
--
-- Also adds branch_id to shop_invites (an invite targets a role at a
-- specific branch) with the same "default to the shop's one branch,
-- transparently, if the caller doesn't pick one" backward-compat pattern
-- used everywhere else in this migration.
-- ============================================================

alter table shop_invites add column if not exists branch_id bigint references branches(branch_id);

update shop_invites i
set branch_id = b.branch_id
from branches b
where b.shop_id = i.shop_id and b.is_default = true and i.branch_id is null;

-- create_shop_invite: optional p_branch_id, defaults to the shop's default
-- branch when omitted (single-branch shops: zero behavior change).
create or replace function create_shop_invite(
  p_shop_id bigint,
  p_email text,
  p_role text,
  p_max_members integer default null,
  p_branch_id bigint default null
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite_id bigint;
  v_caller_role text;
  v_current_count integer;
  v_branch_id bigint;
begin
  select role into v_caller_role from shop_members
  where shop_id = p_shop_id and user_id = auth.uid() and status = 'active'
  limit 1;

  if v_caller_role is null or v_caller_role not in ('owner','manager') then
    raise exception 'ไม่มีสิทธิ์เชิญสมาชิกในอู่นี้';
  end if;

  if p_max_members is not null then
    select
      (select count(*) from shop_members where shop_id = p_shop_id and status = 'active')
      +
      (select count(*) from shop_invites where shop_id = p_shop_id and accepted_at is null and lower(email) <> lower(p_email))
    into v_current_count;

    if v_current_count >= p_max_members then
      raise exception 'จำนวนสมาชิก/คำเชิญค้างถึงขีดจำกัดของแพ็กเกจแล้ว (สูงสุด % คน)', p_max_members;
    end if;
  end if;

  v_branch_id := p_branch_id;
  if v_branch_id is null then
    select branch_id into v_branch_id from branches where shop_id = p_shop_id and is_default = true;
  end if;

  insert into shop_invites (shop_id, email, role, invited_by, branch_id)
  values (p_shop_id, lower(p_email), p_role, auth.uid(), v_branch_id)
  on conflict (shop_id, email) do update set role = excluded.role, accepted_at = null, branch_id = excluded.branch_id
  returning invite_id into v_invite_id;

  return v_invite_id;
end;
$$;

-- accept_pending_invites: both overloads, now branch-aware + fixed ON CONFLICT
create or replace function accept_pending_invites()
returns setof shop_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invite record;
begin
  select email into v_email from auth.users where id = auth.uid();

  for v_invite in
    select * from shop_invites where lower(email) = lower(v_email) and accepted_at is null
  loop
    insert into shop_members (shop_id, user_id, role, status, invited_by, branch_id)
    values (
      v_invite.shop_id, auth.uid(), v_invite.role, 'active', v_invite.invited_by,
      coalesce(v_invite.branch_id, (select branch_id from branches where shop_id = v_invite.shop_id and is_default = true))
    )
    on conflict (shop_id, user_id, branch_id) do nothing;

    update shop_invites set accepted_at = now() where invite_id = v_invite.invite_id;
  end loop;

  return query select * from shop_members where user_id = auth.uid();
end;
$$;

create or replace function accept_pending_invites(p_contact_name text default null, p_contact_phone text default null)
returns setof shop_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invite record;
begin
  select email into v_email from auth.users where id = auth.uid();

  for v_invite in
    select * from shop_invites where lower(email) = lower(v_email) and accepted_at is null
  loop
    insert into shop_members (shop_id, user_id, role, status, invited_by, contact_name, contact_phone, branch_id)
    values (
      v_invite.shop_id, auth.uid(), v_invite.role, 'active', v_invite.invited_by, p_contact_name, p_contact_phone,
      coalesce(v_invite.branch_id, (select branch_id from branches where shop_id = v_invite.shop_id and is_default = true))
    )
    on conflict (shop_id, user_id, branch_id) do nothing;

    update shop_invites set accepted_at = now() where invite_id = v_invite.invite_id;
  end loop;

  return query select * from shop_members where user_id = auth.uid();
end;
$$;

create or replace function accept_shop_invite(p_invite_id bigint, p_contact_name text default null, p_contact_phone text default null)
returns shop_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email  text;
  v_invite record;
  v_member shop_members;
  v_branch_id bigint;
begin
  select auth.users.email into v_email from auth.users where id = auth.uid();

  select * into v_invite from shop_invites
  where invite_id = p_invite_id and lower(email) = lower(coalesce(v_email, ''));

  if v_invite is null then
    raise exception 'ไม่พบคำเชิญนี้ หรืออีเมลไม่ตรงกับบัญชีที่ login อยู่';
  end if;

  if v_invite.accepted_at is not null then
    raise exception 'คำเชิญนี้ถูกใช้ไปแล้ว';
  end if;

  v_branch_id := v_invite.branch_id;
  if v_branch_id is null then
    select branch_id into v_branch_id from branches where shop_id = v_invite.shop_id and is_default = true;
  end if;

  insert into shop_members (shop_id, user_id, role, status, invited_by, contact_name, contact_phone, branch_id)
  values (v_invite.shop_id, auth.uid(), v_invite.role, 'active', v_invite.invited_by, p_contact_name, p_contact_phone, v_branch_id)
  on conflict (shop_id, user_id, branch_id) do update
    set status = 'active', role = excluded.role,
        contact_name = excluded.contact_name, contact_phone = excluded.contact_phone
  returning * into v_member;

  update shop_invites set accepted_at = now() where invite_id = p_invite_id;

  return v_member;
end;
$$;

-- platform_join_as_support: platform admin/support joining a shop always
-- gets the shop's default branch attached (role='manager' already crosses
-- every branch of the shop via is_branch_member()'s owner/manager clause).
create or replace function platform_join_as_support(p_actor_user_id uuid, p_shop_id bigint)
returns shop_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_role text;
  v_new shop_members;
  v_branch_id bigint;
begin
  if auth.uid() is not null and auth.uid() <> p_actor_user_id then
    raise exception 'no permission (actor mismatch)';
  end if;

  select role into v_actor_role from platform_admins where user_id = p_actor_user_id;
  if v_actor_role is null or v_actor_role not in ('super_admin', 'support') then
    raise exception 'no permission to join-as-support';
  end if;

  select branch_id into v_branch_id from branches where shop_id = p_shop_id and is_default = true;

  insert into shop_members (shop_id, user_id, role, status, invited_by, contact_name, branch_id)
  values (p_shop_id, p_actor_user_id, 'manager', 'active', p_actor_user_id, 'Platform Support', v_branch_id)
  on conflict (shop_id, user_id, branch_id) do update set status = 'active', role = 'manager'
  returning * into v_new;

  insert into platform_audit_log (admin_user_id, admin_role, action, status, target_shop_id, new_data)
  values (p_actor_user_id, v_actor_role, 'join_as_support', 'success', p_shop_id, to_jsonb(v_new));

  return v_new;
end;
$$;
