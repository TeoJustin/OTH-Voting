// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title Voting
 * @notice topics are fixed by the constructor, every account may vote exactly once,
 *         accounts on the not-allowed list are rejected, and the result can be read
 *         by anyone at any time.
 */
contract Voting {
    struct Topic {
        string name;
        uint256 voteCount;
    }

    /// account that deployed the contract, set once and never reassigned
    address public immutable owner;

    Topic[] private _topics;

    /// accounts that already cast their single vote
    mapping(address => bool) public hasVoted;

    /// the accounts that are not allowed to vote
    mapping(address => bool) public notAllowedToVote;

    uint256 public totalVotes;

    /// once closed no further votes are accepted, but the result stays readable
    bool public votingClosed;

    event Voted(address indexed voter, uint256 indexed topicIndex);

    error NotOwner(address caller);
    error VotingIsClosed();
    error AlreadyVoted(address caller);
    error NotAllowed(address caller);
    error InvalidTopicIndex(uint256 index);
    error NoTopicsGiven();
    error NoVotesCast();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner(msg.sender);
        _;
    }

    /**
     * @param topicNames the topics that can be voted on, defined once at deployment
     * @param notAllowedAccounts accounts that are blocked from voting, may be empty
     */
    constructor(string[] memory topicNames, address[] memory notAllowedAccounts) {
        if (topicNames.length == 0) revert NoTopicsGiven();
        owner = msg.sender;

        for (uint256 i = 0; i < topicNames.length; ++i) {
            _topics.push(Topic({name: topicNames[i], voteCount: 0}));
        }
        for (uint256 i = 0; i < notAllowedAccounts.length; ++i) {
            notAllowedToVote[notAllowedAccounts[i]] = true;
        }
    }

    /// @notice cast the single vote of the calling account on one topic
    function vote(uint256 topicIndex) external {
        if (votingClosed) revert VotingIsClosed();
        if (topicIndex >= _topics.length) revert InvalidTopicIndex(topicIndex);
        if (notAllowedToVote[msg.sender]) revert NotAllowed(msg.sender);
        if (hasVoted[msg.sender]) revert AlreadyVoted(msg.sender);

        // effects before anything else, so a repeated call can never slip through
        hasVoted[msg.sender] = true;
        _topics[topicIndex].voteCount += 1;
        totalVotes += 1;

        emit Voted(msg.sender, topicIndex);
    }

    /// @notice true when `account` could still cast a vote right now
    function canVote(address account) external view returns (bool) {
        return !votingClosed && !notAllowedToVote[account] && !hasVoted[account];
    }

    /// @notice add or remove an account from the not-allowed list
    function setVotingAllowed(address account, bool allowed) external onlyOwner {
        if (votingClosed) revert VotingIsClosed();
        notAllowedToVote[account] = !allowed;
    }

    /// @notice stop accepting votes, the result stays readable afterwards
    function closeVoting() external onlyOwner {
        votingClosed = true;
    }

    /// @notice the complete result, ready to be printed
    function getResults() external view returns (string[] memory names, uint256[] memory voteCounts) {
        names = new string[](_topics.length);
        voteCounts = new uint256[](_topics.length);

        for (uint256 i = 0; i < _topics.length; ++i) {
            names[i] = _topics[i].name;
            voteCounts[i] = _topics[i].voteCount;
        }
    }

    /// @notice the leading topic, plus whether another topic holds the same count
    function getWinner()
        external
        view
        returns (uint256 index, string memory name, uint256 voteCount, bool tied)
    {
        if (totalVotes == 0) revert NoVotesCast();

        for (uint256 i = 0; i < _topics.length; ++i) {
            uint256 votes = _topics[i].voteCount;
            if (votes > voteCount) {
                voteCount = votes;
                index = i;
                tied = false;
            } else if (votes == voteCount && i != index) {
                tied = true;
            }
        }
        name = _topics[index].name;
    }
}
