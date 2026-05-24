use anchor_lang::{
    prelude::*,
    solana_program::{
        instruction::{AccountMeta, Instruction},
        program::invoke_signed,
    },
};
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

use crate::{
    constants::{
        MODULE_ENTRY_SEED, MODULE_NAV_END, MODULE_NAV_OFFSET, MODULE_VAULT_OFFSET, VAULT_SEED,
    },
    errors::VaultError,
    events::ModuleCapitalDeployedEvent,
    math::{checked_float_cap, total_assets},
    state::{ModuleEntry, Vault},
};

// Anchor instruction discriminator for `global:deposit`, computed as
// sha256("global:deposit")[0..8]. Kept as a constant so the vault can
// call any registered module without depending on that module's Rust crate.
const MODULE_DEPOSIT_DISCRIMINATOR: [u8; 8] = [242, 35, 198, 137, 82, 225, 242, 182];

#[derive(Accounts)]
pub struct DeployToModule<'info> {
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
        constraint = module_entry.module_underlying_token_account == module_underlying_token_account.key()
            @ VaultError::InvalidModule,
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

    #[account(
        mut,
        token::mint = underlying_mint,
        token::token_program = token_program,
    )]
    pub module_underlying_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// CHECK: Generic external module program. It is bound through ModuleEntry
    /// and invoked through a raw CPI to its standard deposit instruction.
    #[account(executable)]
    pub module_program: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
}

impl<'info> DeployToModule<'info> {
    fn transfer_underlying_to_module(&self, amount: u64, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                self.token_program.to_account_info(),
                TransferChecked {
                    from: self.vault_token_account.to_account_info(),
                    mint: self.underlying_mint.to_account_info(),
                    to: self.module_underlying_token_account.to_account_info(),
                    authority: self.vault.to_account_info(),
                },
                signer_seeds,
            ),
            amount,
            self.underlying_mint.decimals,
        )
    }

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

    fn invoke_module_deposit(
        &self,
        amount: u64,
        remaining_accounts: &[AccountInfo<'info>],
        signer_seeds: &[&[&[u8]]],
    ) -> Result<()> {
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
                .any(|account| account.key() == self.module_underlying_token_account.key()),
            VaultError::InvalidModule
        );

        let mut account_metas = Vec::with_capacity(1 + remaining_accounts.len());
        account_metas.push(AccountMeta::new_readonly(self.vault.key(), true));
        account_metas.extend(remaining_accounts.iter().map(|account| {
            if account.is_writable {
                AccountMeta::new(account.key(), account.is_signer)
            } else {
                AccountMeta::new_readonly(account.key(), account.is_signer)
            }
        }));

        let mut data = Vec::with_capacity(16);
        data.extend_from_slice(&MODULE_DEPOSIT_DISCRIMINATOR);
        data.extend_from_slice(&amount.to_le_bytes());

        let instruction = Instruction {
            program_id: self.module_program.key(),
            accounts: account_metas,
            data,
        };

        let mut account_infos = Vec::with_capacity(2 + remaining_accounts.len());
        account_infos.push(self.vault.to_account_info());
        account_infos.extend_from_slice(remaining_accounts);
        account_infos.push(self.module_program.to_account_info());

        invoke_signed(&instruction, &account_infos, signer_seeds)?;

        Ok(())
    }
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, DeployToModule<'info>>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, VaultError::InvalidAmount);
    require!(!ctx.accounts.vault.is_shutdown, VaultError::VaultShutdown);
    require!(
        ctx.accounts.vault_token_account.amount >= amount,
        VaultError::InsufficientLiquidity
    );

    let total_assets_now = total_assets(
        ctx.accounts.vault_token_account.amount,
        ctx.accounts.vault.float_outstanding,
        ctx.accounts.vault.modules_nav_total,
    )?;

    let deployed_value_after = ctx
        .accounts
        .vault
        .float_outstanding
        .checked_add(ctx.accounts.vault.modules_nav_total)
        .ok_or_else(|| error!(VaultError::MathOverflow))?
        .checked_add(amount)
        .ok_or_else(|| error!(VaultError::MathOverflow))?;

    checked_float_cap(
        total_assets_now,
        deployed_value_after,
        ctx.accounts.vault.max_float_bps,
    )?;

    let underlying_mint_key = ctx.accounts.underlying_mint.key();
    let vault_bump = [ctx.accounts.vault.bump];
    let vault_signer_seeds: &[&[&[u8]]] =
        &[&[VAULT_SEED, underlying_mint_key.as_ref(), &vault_bump]];

    ctx.accounts
        .transfer_underlying_to_module(amount, vault_signer_seeds)?;
    ctx.accounts
        .invoke_module_deposit(amount, ctx.remaining_accounts, vault_signer_seeds)?;

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

    emit!(ModuleCapitalDeployedEvent {
        vault: ctx.accounts.vault.key(),
        manager: ctx.accounts.manager.key(),
        module_entry: ctx.accounts.module_entry.key(),
        module_program_id: ctx.accounts.module_entry.module_program_id,
        module_state: ctx.accounts.module_entry.module_state,
        vault_token_account: ctx.accounts.vault_token_account.key(),
        module_token_account: ctx.accounts.module_underlying_token_account.key(),
        amount,
        deployed_value_after,
        old_cached_nav,
        new_cached_nav,
        modules_nav_total,
        slot,
    });

    Ok(())
}
