use anchor_lang::prelude::*;

declare_id!("AZjFTHJFBduuqPf1Gtado4r59rJ8zYqSNFPhiYFDUDzr");

#[program]
pub mod anchor_managed_vault {
    use super::*;

    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Greetings from: {:?}", ctx.program_id);
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Initialize {}
