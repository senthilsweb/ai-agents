"""langgraph-hello — a tiny LangGraph StateGraph, no LLM.

A minimal, self-contained example agent whose second job is to be a clean
Firecracker microVM smoke test: no network, no model weights, no API key, so
it builds tiny and boots fast, and its `probe` node reports the guest kernel /
hostname / IP that prove it is running inside an isolated microVM.
See openspec/changes/add-langgraph-hello/.
"""
