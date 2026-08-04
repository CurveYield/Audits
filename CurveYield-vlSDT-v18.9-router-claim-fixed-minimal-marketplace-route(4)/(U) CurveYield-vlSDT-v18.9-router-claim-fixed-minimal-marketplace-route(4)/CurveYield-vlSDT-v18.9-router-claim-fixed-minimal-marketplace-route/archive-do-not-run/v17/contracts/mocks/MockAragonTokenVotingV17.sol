// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

/**
 * @title CurveYield System Component
 * @notice CurveYield is a decentralized NGO building optimized DeFi systems for the good of all.
 *
 * @dev CurveYield integrates specialized AMM infrastructure, tokenized yield strategies, credit
 * markets, and protocol-owned liquidity into a unified, capital-efficient liquidity stack governed
 * by an open, international DAO community.
 *
 * Protocol operations are enhanced by cross-chain bridging and messaging, MEV capture systems,
 * off-chain to on-chain automation, and peer-to-peer data networks.
 *
 * This contract is one component of the CurveYield system.
 *
 * CurveYield uses proven DeFi primitives where possible and adds targeted coordination and
 * capital-efficiency-enhancing contracts where needed. Users and integrators must review
 * CurveYield documentation before use.
 *
 * Learn more:
 * Documentation: https://docs.curveyield.com
 * dApp: https://curveyield.online
 * GitHub: https://github.com/curveyield
 *
 * Decentralized links may have limited or delayed availability during periods of high network activity:
 * https://curveyield.eth.limo
 * https://curveyield.dao
 *
 * Note: curveyield.dao may require a Brave Browser or an Unstoppable Domains browser plugin to use.
 */

contract MockAragonTokenVotingV17 {
    enum VoteOption { None, Abstain, Yes, No }
    enum VotingMode { Standard, EarlyExecution, VoteReplacement }
    enum Operation { Call, DelegateCall }

    struct ProposalParameters {
        VotingMode votingMode;
        uint32 supportThreshold;
        uint64 startDate;
        uint64 endDate;
        uint64 snapshotTimepoint;
        uint256 minVotingPower;
    }
    struct Tally { uint256 abstain; uint256 yes; uint256 no; }
    struct Action { address to; uint256 value; bytes data; }
    struct TargetConfig { address target; Operation operation; }
    struct ProposalState {
        bool exists;
        bool open;
        bool executed;
        ProposalParameters parameters;
    }

    mapping(uint256 => ProposalState) public proposalState;
    mapping(uint256 => mapping(address => VoteOption)) public voteOption;

    function setProposal(
        uint256 proposalId,
        bool open,
        uint64 startDate,
        uint64 endDate,
        uint64 snapshotTimepoint
    ) external {
        proposalState[proposalId] = ProposalState(
            true,
            open,
            false,
            ProposalParameters(VotingMode.Standard, 500_000, startDate, endDate, snapshotTimepoint, 1)
        );
    }

    function setVoteOption(uint256 proposalId, address voter, VoteOption option) external {
        voteOption[proposalId][voter] = option;
    }

    function getVoteOption(uint256 proposalId, address voter) external view returns (VoteOption) {
        return voteOption[proposalId][voter];
    }

    function getProposal(uint256 proposalId)
        external
        view
        returns (
            bool open,
            bool executed,
            ProposalParameters memory parameters,
            Tally memory tally,
            Action[] memory actions,
            uint256 allowFailureMap,
            TargetConfig memory targetConfig
        )
    {
        ProposalState storage state = proposalState[proposalId];
        open = state.open;
        executed = state.executed;
        parameters = state.parameters;
        tally = Tally(0, 0, 0);
        actions = new Action[](0);
        allowFailureMap = 0;
        targetConfig = TargetConfig(address(0), Operation.Call);
    }
}
