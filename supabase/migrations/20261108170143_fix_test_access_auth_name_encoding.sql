-- Keep the temporary account's Auth metadata consistent with its profile.
update auth.users as auth_user
set raw_user_meta_data = jsonb_set(
  coalesce(auth_user.raw_user_meta_data, '{}'::jsonb),
  '{full_name}',
  to_jsonb('Acesso tempor' || chr(225) || 'rio de teste'),
  true
)
from private.organization_test_access as test_access
where auth_user.id = test_access.user_id;
