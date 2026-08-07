# Current-state baseline

This directory is a local reconstruction baseline for the Negócios K schema
and reference catalog at commit
`d06bedb275e4b178fb0e26fb7e6c56f66726a19b`.

It does not replace or modify historical migrations. It exists because those
migrations contain historical random UUID generation and no longer reproduce
the identities expected by later migrations.

## Contents

- `current_schema.sql`: current `public` and `private` schema contracts plus
  the application-owned read policy on the Supabase-managed `storage.objects`
  table.
- `reference_data.sql`: only the eight approved catalog tables and the private
  `commercial-catalog-images` bucket metadata. It contains no Storage objects.
- `baseline_manifest.json`: source commit, cutoff, counts and SHA-256 checksums.

## Local use

From PowerShell, run:

```powershell
.\scripts\reset-local-from-baseline.ps1
```

The script creates an isolated Supabase workspace under the operating-system
temporary directory. It prints `ALVO CONFIRMADO: SUPABASE LOCAL`, validates the
checksums before applying SQL, registers historical migrations only in that
disposable local database and validates the empty operational state.

The script never accepts or builds a remote database connection. Future normal
migrations must have versions greater than `20260729001230`.

This baseline must never be applied to the linked or remote project.
