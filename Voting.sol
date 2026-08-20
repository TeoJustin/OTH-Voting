// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Voting {
    struct Topic {
        string name;
        uint256 voteCount;
    }

    Topic[] public topics;
    
    // Mapping to check if an address has already voted
    mapping(address => bool) public hasVoted;
    
    // "Whitelist" of accounts that are not allowed to vote (effectively a blacklist)
    mapping(address => bool) public notAllowedToVote; 

    // Contract owner
    address public owner;

    // Events
    event Voted(address indexed voter, uint256 topicIndex);
    event TopicAdded(string topicName);

    // Modifiers
    modifier onlyOwner() {
        require(msg.sender == owner, "Only the owner can perform this action.");
        _;
    }

    modifier canVote() {
        require(!hasVoted[msg.sender], "You have already voted.");
        require(!notAllowedToVote[msg.sender], "You are not allowed to vote.");
        _;
    }

    /**
     * @dev Constructor to define topics and set the owner, and also set the not allowed accounts.
     * @param _topicNames Array of topic names for the voting.
     * @param _notAllowedAccounts Array of accounts that are not allowed to vote.
     */
    constructor(string[] memory _topicNames, address[] memory _notAllowedAccounts) {
        owner = msg.sender;
        
        for (uint i = 0; i < _topicNames.length; i++) {
            topics.push(Topic({
                name: _topicNames[i],
                voteCount: 0
            }));
            emit TopicAdded(_topicNames[i]);
        }

        for (uint i = 0; i < _notAllowedAccounts.length; i++) {
            notAllowedToVote[_notAllowedAccounts[i]] = true;
        }
    }

    /**
     * @dev Function to cast a vote on a specific topic.
     * @param topicIndex The index of the topic to vote for.
     */
    function vote(uint256 topicIndex) public canVote {
        require(topicIndex < topics.length, "Invalid topic index.");

        hasVoted[msg.sender] = true;
        topics[topicIndex].voteCount += 1;
        
        emit Voted(msg.sender, topicIndex);
    }

    /**
     * @dev Get the number of topics to iterate through.
     * @return The total number of topics.
     */
    function getTopicCount() public view returns (uint256) {
        return topics.length;
    }

    /**
     * @dev Get the name of a specific topic.
     * @param index The index of the topic.
     * @return The name of the topic.
     */
    function getTopicName(uint256 index) public view returns (string memory) {
        require(index < topics.length, "Invalid index");
        return topics[index].name;
    }

    /**
     * @dev Get the current vote count for a specific topic.
     * @param index The index of the topic.
     * @return The number of votes the topic has received.
     */
    function getTopicVotes(uint256 index) public view returns (uint256) {
        require(index < topics.length, "Invalid index");
        return topics[index].voteCount;
    }
}
