use std::{env, str::FromStr};

use klend_interface::ReserveInfo;
use solana_client::rpc_client::RpcClient;
use solana_pubkey::Pubkey;

const DEFAULT_RPC_URL: &str = "http://127.0.0.1:8899";
const KLEND_PROGRAM_ID: &str = "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD";
const KAMINO_MAIN_MARKET: &str = "7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF";
const KAMINO_SOL_RESERVE: &str = "d4A2prbA2whesmvHaL88BH6Ewn5N4bTSU2Ze8P6Bc4Q";

fn optional_or_placeholder(value: Option<Pubkey>, placeholder: Pubkey) -> Pubkey {
    value.unwrap_or(placeholder)
}

#[test]
#[ignore = "requires Surfpool/mainnet-fork RPC"]
fn discovers_kamino_sol_reserve_oracles() -> Result<(), Box<dyn std::error::Error>> {
    let rpc_url = env::var("ANCHOR_PROVIDER_URL").unwrap_or_else(|_| DEFAULT_RPC_URL.to_string());
    let klend_program = Pubkey::from_str(KLEND_PROGRAM_ID)?;
    let lending_market = Pubkey::from_str(KAMINO_MAIN_MARKET)?;
    let reserve_address = Pubkey::from_str(KAMINO_SOL_RESERVE)?;

    let rpc_client = RpcClient::new(rpc_url.clone());
    let reserve_account = rpc_client.get_account(&reserve_address)?;

    assert_eq!(
        reserve_account.owner, klend_program,
        "selected reserve is not owned by Klend"
    );

    let reserve_info = ReserveInfo::from_account_data(reserve_address, &reserve_account.data)?;

    assert_eq!(
        reserve_info.lending_market, lending_market,
        "selected reserve belongs to an unexpected lending market"
    );

    println!("RPC endpoint: {rpc_url}");
    println!("reserve: {}", reserve_info.address);
    println!("lending_market: {}", reserve_info.lending_market);
    println!("liquidity_mint: {}", reserve_info.liquidity_mint);
    println!("liquidity_token_program: {}", reserve_info.liquidity_token_program);
    println!();
    println!("Copy this into tests/fixtures/kamino.ts if the values look correct:");
    println!("export const KAMINO_SOL_ORACLE_ACCOUNTS: KaminoReserveOracleAccounts = {{");
    println!(
        "    pythOracle: new PublicKey(\"{}\"),",
        optional_or_placeholder(reserve_info.pyth_oracle, klend_program)
    );
    println!(
        "    switchboardPriceOracle: new PublicKey(\"{}\"),",
        optional_or_placeholder(reserve_info.switchboard_price_oracle, klend_program)
    );
    println!(
        "    switchboardTwapOracle: new PublicKey(\"{}\"),",
        optional_or_placeholder(reserve_info.switchboard_twap_oracle, klend_program)
    );
    println!(
        "    scopePrices: new PublicKey(\"{}\"),",
        optional_or_placeholder(reserve_info.scope_prices, klend_program)
    );
    println!("}};");

    Ok(())
}
