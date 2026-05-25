use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    constants::{
        MODULE_CALL_AUTHORITY_SEED, MODULE_ENTRY_SEED, MODULE_NAV_END, MODULE_NAV_OFFSET,
        MODULE_VAULT_OFFSET, VAULT_SEED,
    },
    errors::VaultError,
    events::ModuleCapitalRecalledFromModuleEvent,
    state::{ModuleEntry, Vault},
};

// Anchor instruction discriminator for `global:withdraw`, computed as
// sha256("global:withdraw")[0..8]. Kept as a constant so the vault can
// call any registered module without depending on that module's Rust crate.
const MODULE_WITHDRAW_DISCRIMINATOR: [u8; 8] = [183, 18, 70, 156, 148, 109, 161, 34];

#[derive(Accounts)]
pub struct RecallFromModule<'info> {
    pub manager: Signer<'info>,

    #[account(
        mut,
        seeds = [VAULT_SEED, underlying_mint.key().as_ref()],
        bump = vault.bump,
        has_one = manager @ VaultError::UnauthorizedManager,
        has_one = underlying_mint,
        has_one = vault_token_account,
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: Non-custodial PDA used only to authenticate vault-initiated CPIs
    /// into external modules. It must never own vault funds or mint authority.
    #[account(
        seeds = [MODULE_CALL_AUTHORITY_SEED, vault.key().as_ref()],
        bump,
    )]
    pub module_call_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [
            MODULE_ENTRY_SEED,
            vault.key().as_ref(),
            module_program.key().as_ref(),
            &module_entry.policy_seed.to_le_bytes(),
        ],
        bump = module_entry.bump,
        constraint = module_entry.vault == vault.key() @ VaultError::InvalidModule,
        constraint = module_entry.module_program_id == module_program.key() @ VaultError::InvalidModule,
        constraint = module_entry.is_active @ VaultError::InvalidModule,
    )]
    pub module_entry: Box<Account<'info, ModuleEntry>>,

    #[account(
        mint::token_program = token_program,
    )]
    pub underlying_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        token::mint = underlying_mint,
        token::authority = vault,
        token::token_program = token_program,
    )]
    pub vault_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Generic external module program. It is bound through ModuleEntry
    /// and invoked through a raw CPI to its standard withdraw instruction.
    #[account(executable)]
    pub module_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> RecallFromModule<'info> {
    fn read_module_cached_nav(&self, remaining_accounts: &[AccountInfo<'info>]) -> Result<u64> {
        let module_state_info = remaining_accounts
            .iter()
            .find(|account| account.key() == self.module_entry.module_state)
            .ok_or_else(|| error!(VaultError::InvalidModuleState))?;

        require_keys_eq!(
            *module_state_info.owner,
            self.module_program.key(),
            VaultError::InvalidModuleState
        );

        let module_state_data = module_state_info.try_borrow_data()?;

        require!(
            module_state_data.len() >= MODULE_NAV_END,
            VaultError::InvalidModuleState
        );

        let module_vault =
            Pubkey::try_from(&module_state_data[MODULE_VAULT_OFFSET..MODULE_NAV_OFFSET])
                .map_err(|_| error!(VaultError::InvalidModuleState))?;

        require_keys_eq!(
            module_vault,
            self.vault.key(),
            VaultError::InvalidModuleState
        );

        let cached_nav_bytes: [u8; 8] = module_state_data[MODULE_NAV_OFFSET..MODULE_NAV_END]
            .try_into()
            .map_err(|_| error!(VaultError::InvalidModuleState))?;

        Ok(u64::from_le_bytes(cached_nav_bytes))
    }

    fn invoke_module_withdraw(
        &self,
        amount: u64,
        remaining_accounts: &[AccountInfo<'info>],
        signer_seeds: &[&[&[u8]]],
    ) -> Result<()> {
        // Recall modules may represent deployed capital with protocol-specific
        // accounts, but every module must expose the registered state account
        // and return underlying into the vault token account passed here.
        let module_state_info = remaining_accounts
            .iter()
            .find(|account| account.key() == self.module_entry.module_state)
            .ok_or_else(|| error!(VaultError::InvalidModuleState))?;

        require_keys_eq!(
            *module_state_info.owner,
            self.module_program.key(),
            VaultError::InvalidModuleState
        );

        require!(
            remaining_accounts
                .iter()
                .any(|account| account.key() == self.vault_token_account.key()),
            VaultError::InvalidModule
        );

        let mut account_metas = Vec::with_capacity(1 + remaining_accounts.len());
        account_metas.push(AccountMeta::new_readonly(
            self.module_call_authority.key(),
            true,
        ));
        account_metas.extend(remaining_accounts.iter().map(|account| {
            if account.is_writable {
                AccountMeta::new(account.key(), account.is_signer)
            } else {
                AccountMeta::new_readonly(account.key(), account.is_signer)
            }
        }));

        let mut data = Vec::with_capacity(16);
        data.extend_from_slice(&MODULE_WITHDRAW_DISCRIMINATOR);
        data.extend_from_slice(&amount.to_le_bytes());

        let instruction = Instruction {
            program_id: self.module_program.key(),
            accounts: account_metas,
            data,
        };

        let mut account_infos = Vec::with_capacity(2 + remaining_accounts.len());
        account_infos.push(self.module_call_authority.to_account_info());
        account_infos.extend_from_slice(remaining_accounts);
        account_infos.push(self.module_program.to_account_info());

        invoke_signed(&instruction, &account_infos, signer_seeds)?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, RecallFromModule<'info>>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);

    let vault_token_balance_before = ctx.accounts.vault_token_account.amount;
    let vault_key = ctx.accounts.vault.key();
    let module_call_authority_bump = [ctx.bumps.module_call_authority];
    let module_call_authority_signer_seeds: &[&[&[u8]]] = &[&[
        MODULE_CALL_AUTHORITY_SEED,
        vault_key.as_ref(),
        &module_call_authority_bump,
    ]];

    ctx.accounts.invoke_module_withdraw(
        amount,
        ctx.remaining_accounts,
        module_call_authority_signer_seeds,
    )?;
    ctx.accounts.vault_token_account.reload()?;

    let returned_amount = ctx
        .accounts
        .vault_token_account
        .amount
        .checked_sub(vault_token_balance_before)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;
    require!(
        returned_amount >= amount,
        VaultError::InsufficientReturnedLiquidity
    );

    let old_cached_nav = ctx.accounts.module_entry.cached_nav;
    let new_cached_nav = ctx
        .accounts
        .read_module_cached_nav(ctx.remaining_accounts)?;
    let modules_nav_total = ctx
        .accounts
        .vault
        .modules_nav_total
        .checked_sub(old_cached_nav)
        .ok_or_else(|| error!(VaultError::MathOverflow))?
        .checked_add(new_cached_nav)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;
    let slot = Clock::get()?.slot;

    ctx.accounts.module_entry.cached_nav = new_cached_nav;
    ctx.accounts.module_entry.nav_last_updated_slot = slot;
    ctx.accounts.vault.modules_nav_total = modules_nav_total;

    emit!(ModuleCapitalRecalledFromModuleEvent {
        vault: ctx.accounts.vault.key(),
        manager: ctx.accounts.manager.key(),
        module_entry: ctx.accounts.module_entry.key(),
        module_program_id: ctx.accounts.module_entry.module_program_id,
        module_state: ctx.accounts.module_entry.module_state,
        vault_token_account: ctx.accounts.vault_token_account.key(),
        requested_amount: amount,
        returned_amount,
        old_cached_nav,
        new_cached_nav,
        modules_nav_total,
        slot,
    });

    Ok(())
}
