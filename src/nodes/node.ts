import bodyParser from 'body-parser';
import express from 'express';
import http from 'http';
import { BASE_NODE_PORT } from '../config';
import { NodeState, Value } from '../types';
import { delay } from '../utils';

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
): Promise<http.Server> {
  const app = express();
  app.use(express.json());
  app.use(bodyParser.json());

  let currentState: NodeState = {
    killed: false,
    x: isFaulty ? null : initialValue,
    decided: isFaulty ? null : false,
    k: isFaulty ? null : 1,
  };

  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();

  app.get('/status', (req, res) => {
    res.status(isFaulty ? 500 : 200).send(isFaulty ? 'faulty' : 'live');
  });

  app.get('/stop', (req, res) => {
    // Mark the node as 'killed' and set 'decided', 'x', and 'k' to null to simulate a faulty node
    currentState.killed = true;
    currentState.decided = null;
    currentState.x = null;
    currentState.k = null;
    res.status(200).send('Node stopped and marked as faulty');
  });

  app.get('/getState', (req, res) => {
    res.status(200).send(currentState);
  });

  app.get('/start', async (req, res) => {
    while (!nodesAreReady()) await delay(5);
    if (!isFaulty) initiateConsensus();
    res.status(200).send('Consensus algorithm started.');
  });

  app.post('/message', async (req, res) => {
    if (isFaulty || currentState.killed) {
      res.status(200).send('Message received but ignored.');
      return;
    }

    const { k, x, messageType } = req.body;
    if (messageType === 'propose') {
      handleProposal(k, x);
    } else if (messageType === 'vote') {
      handleVote(k, x);
    }

    res.status(200).send('Message received and processed.');
  });

  const server = app.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);
    setNodeIsReady(nodeId);
  });

  function initiateConsensus() {
    if (currentState.k !== null && currentState.x !== null) { // Check that k and x are not null
      broadcastMessage(currentState.k, currentState.x, 'propose');
    }
  }

  function handleProposal(k: number, x: Value) {
    updateMap(proposals, k, x);
    const proposalValues = proposals.get(k);
    if (proposalValues && proposalValues.length >= N - F) {
      decideAndBroadcast(k, proposalValues);
    }
  }

  function handleVote(k: number, x: Value) {
    updateMap(votes, k, x);
    const voteValues = votes.get(k);
    if (voteValues && voteValues.length >= N - F) {
      finalDecision(k, voteValues);
    }
  }

  function updateMap(map: Map<number, Value[]>, k: number, x: Value) {
    const values = map.get(k) || [];
    values.push(x);
    map.set(k, values); // Reassign to ensure update is captured
  }

  function decideAndBroadcast(k: number, proposal: Value[]) {
    let count = countVotes(proposal);
    let decision: Value = count[0] > N / 2 ? 0 : count[1] > N / 2 ? 1 : Math.random() > 0.5 ? 0 : 1; // Ensure decision is of type Value
    broadcastMessage(k, decision, 'vote');
  }

  function finalDecision(k: number, vote: Value[]) {
    let count = countVotes(vote);
    if (count[0] >= F + 1 || count[1] >= F + 1) {
      currentState.x = count[0] > count[1] ? 0 : 1;
      currentState.decided = true;
    } else {
      currentState.k = k + 1;
      currentState.x = Math.random() > 0.5 ? 0 : 1;
      broadcastMessage(currentState.k, currentState.x, 'propose');
    }
  }

  function broadcastMessage(k: number, x: Value, messageType: string) {
    for (let i = 0; i < N; i++) {
      sendMessage(`http://localhost:${BASE_NODE_PORT + i}/message`, { k, x, messageType });
    }
  }

  function countVotes(array: Value[]): number[] {
    let counts = [0, 0]; // counts[0] for 0s, counts[1] for 1s
    array.forEach((value) => {
      if (value !== '?') {
        counts[value]++;
      }
    });
    return counts;
  }

  function sendMessage(url: string, body: any) {
    http.request(
      url,
      { method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        res.on('data', () => {}); // No need to do anything with the response
      }
    )
      .on('error', (error) => {
        console.error(error);
      })
      .end(JSON.stringify(body));
  }

  return server;
}
