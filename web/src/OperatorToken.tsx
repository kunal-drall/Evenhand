import { useState } from "react";
import { operatorToken, setOperatorToken } from "./api";

/** One field for the server's OPERATOR_TOKEN, kept in this browser. */
export function OperatorToken({ onChange }: { onChange: () => void }) {
  const [value, setValue] = useState(operatorToken);
  return (
    <label className="form">
      Operator token{" "}
      <input
        type="password"
        value={value}
        autoComplete="off"
        onChange={(e) => {
          setValue(e.target.value);
          setOperatorToken(e.target.value);
          onChange();
        }}
        placeholder="from the server's OPERATOR_TOKEN"
      />
    </label>
  );
}
