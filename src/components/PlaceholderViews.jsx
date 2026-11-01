import React from 'react';

function Planned({ title, blurb, items }) {
  return (
    <div className="stage-scroll">
      <div className="card wide">
        <span className="planned-tag">Not built in this slice</span>
        <h2>{title}</h2>
        <p>{blurb}</p>
        <ul className="limits">
          {items.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
        <p className="fineprint">
          This screen exists so the shell is honest about its shape: the tab is present, the
          feature behind it is not. Nothing here is mocked to look finished.
        </p>
      </div>
    </div>
  );
}

export function StatusView() {
  return (
    <Planned
      title="Status"
      blurb="24-hour disappearing updates with a per-viewer TTL, as described in the blueprint's storage tier."
      items={[
        'Client-side encrypted status media',
        'Viewer receipts and 24h expiry sweep',
        'Ring UI in the chat list',
      ]}
    />
  );
}

export function ChannelsView() {
  return (
    <Planned
      title="Channels"
      blurb="One-to-many broadcast feed, with the bot platform layered on top of it."
      items={[
        'Channel creation and admin roles',
        'Follower fan-out on the messaging edge',
        'Bot publishing API (/bot<token>/sendMessage)',
      ]}
    />
  );
}

export function CallsView() {
  return (
    <Planned
      title="Calls"
      blurb="WebRTC voice and video with an SFU, plus the call-signalling path over the same encrypted channel."
      items={[
        'Signalling over the existing WebSocket',
        'SRTP media with DTLS-SRTP key exchange',
        'TURN relay — required for real NAT traversal',
      ]}
    />
  );
}
